import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { root } from '../service/config.mjs';
import { SubtitleDatabase, subtitleHash, episodeHash } from '../service/database.mjs';
// data/ is gitignored, so a fresh clone does not have it yet.
await mkdir(path.join(root, 'data'), { recursive: true });
test('complete translations are per target language; Codex upgrades batch results but nothing else overwrites', async () => {
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
    assert.equal(db.get({...request,provider:'google'})[0].text,'本地');
    assert.equal(db.get({...request,target:'ja'}),null);
    assert.equal(db.get({...request,provider:'codex'}),null);
    assert.equal(db.get({...request,provider:'codex'},{fallback:true})[0].text,'本地');
    db.put({...request,provider:'google'},[{sourceIds:['a'],text:'谷歌'}]);
    assert.equal(db.get(request)[0].text,'本地');
    db.put({...request,provider:'codex'},[{sourceIds:['a'],text:'整集'}]);
    assert.equal(db.get(request)[0].text,'整集'); assert.equal(db.get({...request,provider:'codex'})[0].text,'整集');
    db.put({...request,provider:'local'},[{sourceIds:['a'],text:'又一份'}]);
    db.put({...request,provider:'codex'},[{sourceIds:['a'],text:'第二份整集'}]);
    assert.equal(new SubtitleDatabase(db.file,{model:'different'}).get(request)[0].text,'整集');
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
