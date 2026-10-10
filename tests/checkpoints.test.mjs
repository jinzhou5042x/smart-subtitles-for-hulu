import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCheckpoints, windowEnd } from '../service/checkpoints.mjs';
import { keyedOutput, timestampKey } from '../service/keyed.mjs';
const cues = [0,59,60,119,120].map((start,i) => ({id:String(i),start,end:start+2,text:`source ${i}`}));
const request = {cues,target:'zh-CN'};
const segments = cues.map(c=>({sourceIds:[c.id],text:`译 ${c.id}`}));

test('one input and output stream produces all one-minute checkpoints without additional requests', async () => {
  assert.equal(windowEnd(cues,0),2);
  let calls=0; const writes=[],published=[];
  const translator={translateEpisode:async(r,signal,progress)=>{
    calls++; assert.equal(r.cues.length,5);
    for(let i=1;i<=5;i++)progress({partialSegments:segments.slice(0,i)});
    return segments;
  }};
  await translateCheckpoints(request,translator,undefined,p=>published.push(p.completedCues),s=>writes.push(s.length));
  assert.equal(calls,1); assert.deepEqual(writes,[2,4,5]);
  assert.ok(published.every(n=>[0,2,4,5].includes(n)));
});
test('fixed keys preserve binding when output order changes and JSON arrives one character at a time',()=>{
  const text=JSON.stringify({translations:Object.fromEntries([[4,'尾'],[1,'He said: "hi"'],[0,'首'],[3,'中'],[2,'换\n行']].map(([i,translation])=>[timestampKey(cues[i]),{source:cues[i].text,translation}]))});
  const codec=keyedOutput(request);
  for(const char of text)codec.feed(char);
  const result=codec.finish(text);
  assert.deepEqual(result.map(s=>s.sourceIds[0]),['0','1','2','3','4']);
  assert.equal(result[0].text,'首');assert.equal(result[4].text,'尾');
  assert.deepEqual(result.map(s=>s.start),cues.map(c=>c.start));
});
test('missing, duplicate, unknown and empty slots cannot be accepted as complete',()=>{
  for(const text of ['{"translations":{"0–2":{"source":"source 0","translation":"ok"}}}',
    '{"translations":{"0–2":{"source":"source 0","translation":"ok"},"0–2":{"source":"source 0","translation":"again"}}}',
    '{"translations":{"wrong":{"source":"source 0","translation":"ok"}}}',
    '{"translations":{"0–2":{"source":"source 0","translation":""}}}']) {
    assert.throws(()=>keyedOutput(request).finish(text));
  }
});
test('source must be exact, appear first, and be complete before any translation is published',()=>{
  for(const value of [
    '{"source":"source 1","translation":"wrong slot"}',
    '{"source":"source 0 ","translation":"changed whitespace"}',
    '{"translation":"before source","source":"source 0"}',
    '{"source":"source 0","source":"source 0","translation":"duplicate"}',
    '{"source":"source 0","translation":"ok","translation":"duplicate"}',
    '{"source":"source 0","translation":"ok","extra":"unexpected"}'
  ]) {
    let published=false;
    const codec=keyedOutput(request,()=>{published=true;});
    assert.throws(()=>codec.finish('{"translations":{"0–2":'+value+'}}'));
    assert.equal(published,false);
  }
  const codec=keyedOutput(request);
  assert.equal(codec.schema.properties.translations.properties['0–2'].properties.source.type,'string');
});
test('original source escapes and line breaks survive arbitrary chunk boundaries',()=>{
  const r={...request,cues:[{id:'escaped',start:3,end:5,text:'He said: "hi"\n{braces} \\'}]};
  const text=JSON.stringify({translations:{'3–5':{source:r.cues[0].text,translation:'他说：你好'}}});
  for(const size of [1,2,7,text.length]){
    let published=0;const codec=keyedOutput(r,()=>published++);
    for(let i=0;i<text.length;i+=size)codec.feed(text.slice(i,i+size));
    assert.equal(codec.finish(text)[0].start,3);assert.equal(published,1);
  }
});
test('timestamp must match both endpoints exactly; no rounding or fuzzy remapping',()=>{
  const r={...request,cues:[{id:'a',start:1.2345,end:2.3456,text:'Exact'}]};
  for(const key of ['1.235–2.346','1.2345–2.3457','1.23450–2.3456']) {
    assert.throws(()=>keyedOutput(r).finish(JSON.stringify({translations:{[key]:{source:'Exact',translation:'准确'}}})),/timestamp/);
  }
});
test('shared timestamps preserve separate cues and match exact sources even in reversed order',()=>{
  const r={...request,cues:[{id:'a',start:1,end:2,text:'First'},{id:'b',start:1,end:2,text:'Second'}]};
  const text=JSON.stringify({translations:{'1–2':[{source:'Second',translation:'第二'},{source:'First',translation:'第一'}]}});
  const codec=keyedOutput(r);for(const char of text)codec.feed(char);
  assert.deepEqual(codec.finish(text).map(s=>[s.sourceIds[0],s.text]),[['a','第一'],['b','第二']]);
  assert.throws(()=>keyedOutput(r).finish(JSON.stringify({translations:{'1–2':[{source:'First',translation:'一'},{source:'First',translation:'重复'}]}})),/original source/);
});
test('resume sends complete episode context once, while requiring only unsaved output slots',()=>{
  const codec=keyedOutput({...request,accepted:segments.slice(0,2)});
  assert.equal(codec.input.cues.length,5);
  assert.deepEqual(codec.schema.properties.translations.required,['60–62','119–121','120–122']);
  assert.equal(codec.finish(JSON.stringify({translations:Object.fromEntries([2,3,4].map(i=>[timestampKey(cues[i]),{source:cues[i].text,translation:String(i)}]))})).length,5);
});
test('a failed output retains completed windows without another model request',async()=>{
  let calls=0;const writes=[];
  await assert.rejects(translateCheckpoints(request,{translateEpisode:async(r,s,p)=>{
    calls++;p({partialSegments:segments.slice(0,3)});throw new Error('offline');
  }},undefined,()=>{},s=>writes.push(s.length)),/offline/);
  assert.equal(calls,1);assert.deepEqual(writes,[2]);
});
test('disk failure blocks publication and terminates the current output',async()=>{
  let published=false;
  await assert.rejects(translateCheckpoints(request,{translateEpisode:async(r,s,p)=>{p({partialSegments:segments});return segments;}},undefined,p=>{if(p.completedCues)published=true;},()=>{throw new Error('disk full');}),/disk full/);
  assert.equal(published,false);
});
test('publication uses database read-back and rejects an incomplete read-back',async()=>{
  const translator={translateEpisode:async(r,s,p)=>{p({partialSegments:segments});return segments;}};
  const published=[];
  await translateCheckpoints(request,translator,undefined,p=>published.push(p.partialSegments),prefix=>prefix.map(s=>({...s,text:'stored '+s.sourceIds[0]})));
  assert.ok(published.flat().every(s=>s.text.startsWith('stored ')));
  let shown=false;
  await assert.rejects(translateCheckpoints(request,translator,undefined,p=>{if(p.completedCues)shown=true;},()=>[]));
  assert.equal(shown,false);
});
test('a full-looking stream cannot save the final window before successful turn completion',async()=>{
  const writes=[];
  await assert.rejects(translateCheckpoints(request,{translateEpisode:async(r,s,p)=>{p({partialSegments:segments});throw new Error('failed turn');}},undefined,()=>{},s=>writes.push(s.length)),/failed turn/);
  assert.deepEqual(writes,[2,4]);
});

// Seen on 2026-10-10: one line of 978 came back with a source that was not an exact copy and
// the whole episode stopped at "Translation paused" until Retry was pressed; the same request
// then ran without a mismatch twice.
test('a line the model wrote wrongly is asked for again from the last saved window, a few times, by itself', async () => {
  const slip = () => Object.assign(new Error('Subtitle 60–62 does not match its original source'), { modelOutput: true });
  const starts = []; let calls = 0;
  const translator = { translateEpisode: async (r, signal, progress) => {
    calls++; starts.push(r.accepted.length);
    if (calls === 1) { progress({ partialSegments: segments.slice(0, 3) }); throw slip(); }
    progress({ partialSegments: segments }); return segments;
  } };
  const phases = [], writes = [];
  const done = await translateCheckpoints(request, translator, undefined, p => phases.push(p.phase), s => writes.push(s.length));
  assert.equal(done.length, 5); assert.deepEqual(starts, [0, 2], 'the second attempt starts after the saved window, not from the start');
  assert.ok(phases.includes('retrying')); assert.deepEqual(writes, [2, 4, 5], 'nothing is saved twice');
  // A window that fails twice with the whole episode is translated alone, then the episode goes on.
  const asked = [];
  const picky = { translateEpisode: async (r, signal, progress) => {
    asked.push([r.cues.length, r.accepted.length]);
    if (r.cues.length < 5) return r.cues.map(c => ({ sourceIds: [c.id], text: `alone ${c.id}` }));
    if (r.accepted.length === 0) { progress({ partialSegments: segments.slice(0, 2) }); throw slip(); }
    if (r.accepted.length === 2) throw slip();
    const out = [...r.accepted, ...segments.slice(r.accepted.length)];
    progress({ partialSegments: out }); return out;
  } };
  const saves = [];
  const repaired = await translateCheckpoints(request, picky, undefined, () => {}, s => saves.push(s.length));
  assert.deepEqual(asked, [[5, 0], [5, 2], [2, 0], [5, 4]], 'the episode, the episode again, the stuck minute alone, then the rest');
  assert.deepEqual(repaired.map(s => s.text), ['译 0', '译 1', 'alone 2', 'alone 3', '译 4']); assert.deepEqual(saves, [2, 4, 5]);
  // Only a window that also fails alone, four times, is reported, and then as the viewer's to see.
  let stubborn = 0;
  await assert.rejects(translateCheckpoints(request, { translateEpisode: async () => { stubborn++; throw slip(); } }), error => /does not match/.test(error.message) && error.needsUser === true);
  assert.equal(stubborn, 6);
  // What is not the model's writing is never retried here.
  let other = 0;
  await assert.rejects(translateCheckpoints(request, { translateEpisode: async () => { other++; throw new Error('usage limit reached'); } }), /usage limit/);
  assert.equal(other, 1);
});

test('a source that is not an exact copy is rejected, marked as the model\'s writing, and described without quoting it', () => {
  const two = { cues: [{ id: 'a', start: 507.174, end: 510.427, text: "I've been spending a lot\nof time with my kids," }, { id: 'b', start: 510.427, end: 512.971, text: 'and I just, like, let life unfold.' }], target: 'zh-CN' };
  const answer = source => JSON.stringify({ translations: { [timestampKey(two.cues[0])]: { source, translation: '我一直花很多时间陪孩子，' }, [timestampKey(two.cues[1])]: { source: two.cues[1].text, translation: '就这样顺其自然。' } } });
  const fed = source => { try { keyedOutput(two).feed(answer(source)); return null; } catch (error) { return error; } };
  assert.equal(fed(two.cues[0].text), null);
  for (const [source, how] of [["I've been spending a lot of time with my kids,", 'only spacing or line breaks differ'], ["I’ve been spending a lot\nof time with my kids,", 'only letter case or quotation marks differ'], ["I've been spending a lot\nof time with my kids, and I just, like, let life unfold.", 'text was added or left out'], ['Something else entirely.', 'different text']]) {
    const error = fed(source);
    assert.equal(error.modelOutput, true); assert.ok(error.message.endsWith(`(${how})`), error.message);
    assert.ok(!/kids|spending/.test(error.message), 'no dialogue in the message');
  }
});
