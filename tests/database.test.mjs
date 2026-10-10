import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { root } from '../service/config.mjs';
import { SubtitleDatabase, subtitleHash, episodeHash } from '../service/database.mjs';
// data/ is gitignored, so a fresh clone does not have it yet.
await mkdir(path.join(root, 'data'), { recursive: true });
test('legacy cache is archived and only explicitly bound checkpoints survive restart', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-db-'));
  try {
    const file = path.join(dir, 'subtitles.sqlite');
    const request = { target: 'zh-CN', provider: 'codex', cues: [0, 1].map(i => ({ id: String(i), start: i, end: i + 1, text: 'Source ' + i })) };
    const old = request.cues.map(c => ({ sourceIds: [c.id], text: 'old ' + c.id }));
    new SubtitleDatabase(file, {}).put(request, old);
    const db = new SubtitleDatabase(file, { requireBinding: true });
    assert.equal(db.get(request), null); assert.deepEqual(db.partial(request), []);
    assert.equal(db.with(sql => JSON.parse(sql.prepare('SELECT lines FROM legacy_translations').get().lines).length), 2);
    db.save(request, [{ ...old[0], text: 'corrected' }]);
    const restarted = new SubtitleDatabase(file, { requireBinding: true });
    assert.equal(restarted.partial(request)[0].text, 'corrected');
    assert.equal(restarted.with(sql => JSON.parse(sql.prepare('SELECT lines FROM legacy_translations').get().lines)[1].text), 'old 1');
    restarted.put(request, [{ ...old[0], text: 'corrected' }, old[1]]);
    assert.equal(restarted.get(request)[0].text, 'corrected');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('complete translations are per target language and per translator; a translator\'s first complete result is kept', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-db-'));
  try {
    const db = new SubtitleDatabase(path.join(dir, 'subtitles.sqlite'), {});
    const request = { target:'zh-CN', provider:'local', cues:[{id:'a',start:0,end:1,text:'Hello world'}] };
    const same = {...request,cues:[{id:'b',start:0,end:1,text:'Hello\nworld'}]};
    assert.equal(subtitleHash(request.cues),subtitleHash(same.cues));
    assert.notEqual(subtitleHash(request.cues),subtitleHash([{...request.cues[0],end:2}]));
    assert.equal(db.get(request),null);
    db.put(request,[{sourceIds:['a'],text:'本地'}]);
    assert.equal(db.get(same)[0].sourceIds[0],'b');
    assert.equal(db.get({...request,provider:'google'}),null);
    assert.equal(db.get({...request,target:'ja'}),null);
    assert.equal(db.get({...request,provider:'codex'}),null);
    db.put({...request,provider:'google'},[{sourceIds:['a'],text:'谷歌'}],{input:5,output:2});
    assert.equal(db.get(request)[0].text,'本地'); assert.equal(db.get({...request,provider:'google'})[0].text,'谷歌');
    db.put({...request,provider:'codex'},[{sourceIds:['a'],text:'整集'}],{input:90,output:30});
    assert.equal(db.get(request)[0].text,'本地'); assert.equal(db.get({...request,provider:'codex'})[0].text,'整集');
    assert.equal(db.usage(request),null); assert.equal(db.usage({...request,provider:'google'}).input,5); assert.equal(db.usage({...request,provider:'codex'}).input,90);
    db.put({...request,provider:'local'},[{sourceIds:['a'],text:'又一份'}]);
    db.put({...request,provider:'codex'},[{sourceIds:['a'],text:'第二份整集'}]);
    const reopened = new SubtitleDatabase(db.file,{model:'different'});
    assert.equal(reopened.get(request)[0].text,'本地'); assert.equal(reopened.get({...request,provider:'codex'})[0].text,'整集');
    assert.equal(db.get({...request,cues:[{...request.cues[0],end:2}]}),null);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('the episode hash covers the normalized subtitles and the target language code', () => {
  const cues = [{ id: 'a', start: 0, end: 1, text: 'Hello world' }];
  assert.equal(episodeHash({ target: 'zh-CN', cues }), episodeHash({ target: 'zh-CN', cues: [{ ...cues[0], id: 'b', text: 'Hello\nworld' }] }));
  assert.notEqual(episodeHash({ target: 'zh-CN', cues }), episodeHash({ target: 'zh-TW', cues }));
  assert.match(episodeHash({ target: 'ja', cues }), /^[a-f0-9]{64}$/);
});

test('one source hash holds several target languages, each with its own partial or complete lines', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-db-'));
  try {
    const db = new SubtitleDatabase(path.join(dir, 'subtitles.sqlite'), {});
    const cues = ['One.', 'Two.', 'Three.'].map((text, i) => ({ id: 'c' + i, start: i * 2, end: i * 2 + 1, text }));
    const zh = { target: 'zh-CN', provider: 'codex', cues }, ja = { ...zh, target: 'ja' };
    db.save(zh, [{ sourceIds: ['c0'], text: '一' }]);
    db.save(zh, [{ sourceIds: ['c0'], text: '一' }, { sourceIds: ['c1'], text: '二' }]);
    db.save(zh, [{ sourceIds: ['c0'], text: '一' }]); // an older, shorter prefix never shrinks it
    db.put(ja, cues.map(c => ({ sourceIds: [c.id], text: 'ja ' + c.text })));
    assert.deepEqual(db.partial(zh).map(s => s.text), ['一', '二']); assert.equal(db.get(zh), null);
    assert.deepEqual(db.partial(ja), []); assert.equal(db.get(ja).length, 3);
    const raw = new DatabaseSync(db.file);
    try {
      assert.equal(raw.prepare('SELECT COUNT(*) n FROM sources').get().n, 1);
      assert.deepEqual(raw.prepare('SELECT target, done, complete FROM translations ORDER BY target').all().map(r => ({ ...r })), [{ target: 'ja', done: 3, complete: 1 }, { target: 'zh-CN', done: 2, complete: 0 }]);
      assert.deepEqual(raw.prepare("SELECT idx, text FROM lines WHERE target='zh-CN' ORDER BY idx").all().map(r => [r.idx, r.text]), [[0, '一'], [1, '二']]);
      assert.equal(JSON.parse(raw.prepare('SELECT cues FROM sources').get().cues)[1].start, 2);
    } finally { raw.close(); }
    db.put(zh, cues.map((c, i) => ({ sourceIds: [c.id], text: ['一', '二', '三'][i] })));
    assert.deepEqual(db.get(zh).map(s => s.text), ['一', '二', '三']); assert.deepEqual(db.partial(zh), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('complete episodes of the 0.9.0 table are migrated', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-db-'));
  try {
    const file = path.join(dir, 'subtitles.sqlite'), cues = [{ start: 0, end: 1, text: 'Hi' }, { start: 1.1, end: 2, text: 'there' }];
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE episodes(hash TEXT PRIMARY KEY, target TEXT NOT NULL, provider TEXT NOT NULL, cues TEXT NOT NULL, segments TEXT NOT NULL, created_at TEXT NOT NULL)');
    old.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?)').run('x', 'zh-CN', 'local', JSON.stringify(cues), JSON.stringify([{ indices: [0, 1], text: '你好' }]), '2026-10-01T00:00:00.000Z');
    old.close();
    const request = { target: 'zh-CN', provider: 'local', cues: cues.map((c, i) => ({ ...c, id: 'n' + i })) };
    assert.deepEqual(new SubtitleDatabase(file, {}).get(request).map(s => s.sourceIds), [['n0', 'n1']]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('translating again keeps the record in use until the new one is complete, then replaces only that translator\'s', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-db-'));
  try {
    const db = new SubtitleDatabase(path.join(dir, 'subtitles.sqlite'), { requireBinding: true });
    const cues = [0, 1].map(i => ({ id: String(i), start: i, end: i + 1, text: 'Source ' + i }));
    const request = { target: 'zh-CN', provider: 'codex', cues }, redo = { ...request, redo: '11111111-1111-4111-8111-111111111111' };
    const lines = word => cues.map(c => ({ sourceIds: [c.id], text: `${word} ${c.id}` }));
    db.put(request, lines('old'), { input: 10, output: 5 });
    db.put({ ...request, provider: 'google' }, lines('google'));
    assert.equal(db.get(redo), null); assert.deepEqual(db.partial(redo), []);
    db.save(redo, lines('new').slice(0, 1), { usage: { input: 3, output: 1 } });
    assert.deepEqual(db.get(request).map(s => s.text), ['old 0', 'old 1'], 'the draft does not touch the record');
    assert.deepEqual(db.partial(redo).map(s => s.text), ['new 0']); assert.deepEqual(db.partial(request), []);
    assert.equal(db.usage(request).input, 10); assert.equal(db.usage(redo, { partial: true }).input, 3);
    db.put(redo, lines('new'), { input: 7, output: 4 });
    assert.deepEqual(db.get(request).map(s => s.text), ['new 0', 'new 1']);
    assert.equal(db.usage(request).input, 7); assert.deepEqual(db.partial(redo), []);
    assert.deepEqual(db.get({ ...request, provider: 'google' }).map(s => s.text), ['google 0', 'google 1']);
    assert.equal(db.with(sql => sql.prepare('SELECT COUNT(*) n FROM translations').get().n), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
