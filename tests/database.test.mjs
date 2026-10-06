import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../service/config.mjs';
import { SubtitleDatabase, subtitleHash, episodeHash } from '../service/database.mjs';
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
