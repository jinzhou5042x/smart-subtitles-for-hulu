import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root } from '../service/config.mjs';
import { LocalTranslator, parseLocalTranslation, localGrammar } from '../service/local.mjs';
import { cacheKey, validateRequest } from '../service/translation.mjs';
const request = { provider: 'local', client: 'a', epoch: '1', session: 'movie', target: 'zh-CN', context: [], cues: [{ id: 'a', start: 1, end: 2, text: 'Break a leg.' }, { id: 'b', start: 3, end: 4, text: 'Thanks.' }] };
const output = '[1] Break a leg. => 祝你演出成功。\n[2] Thanks. => 谢谢。';
function stream(content, finish = 'stop') {
  const text = [...content].map(c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }));
}
test('local mode sends whole input once, handles fragmented UTF-8 SSE, preserves source timing and isolates caches', async () => {
  let generations = 0;
  const translator = new LocalTranslator({}, async (url, options) => {
    if (url.endsWith('/tokenize')) return Response.json({ tokens: [1, 2] });
    generations++;
    const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.includes('Break a leg.')); assert.ok(body.messages[0].content.includes('Thanks.'));
    assert.equal(body.grammar, localGrammar(request.cues));
    return stream(output);
  });
  translator.start = async () => {};
  const result = await translator.translate(request);
  assert.equal(generations, 1); assert.equal(result[0].start, 1); assert.equal(result[1].end, 4); assert.equal(result[0].text, '祝你演出成功。');
  assert.equal(validateRequest(request).provider, 'local');
  for (const provider of ['google', 'codex']) assert.notEqual(cacheKey(request, {}), cacheKey({ ...request, provider }, {}));
});
test('local rejects missing/reordered output, truncated streams, and oversized context', async () => {
  assert.throws(() => parseLocalTranslation('{"translations":[]}', request.cues), /incomplete batch/);
  assert.throws(() => parseLocalTranslation(output.replace('[2]', '[3]'), request.cues), /order/);
  assert.throws(() => parseLocalTranslation(output.replace('Thanks.', 'Wrong source.'), request.cues), /does not match the source/);
  const translator = new LocalTranslator({}, async url => url.endsWith('/tokenize') ? Response.json({ tokens: [1] }) : stream(output, 'length'));
  translator.start = async () => {};
  await assert.rejects(translator.translate(request), /ended early/);
  translator.config.localContextSize = 1024;
  await assert.rejects(translator.translate(request), /context/);
});
test('local cancellation aborts in-flight inference without unloading the model or returning partial output', async () => {
  const abort = new AbortController(); let stopped = 0, signalled = false;
  const translator = new LocalTranslator({}, async (url, options) => {
    if (url.endsWith('/tokenize')) return Response.json({ tokens: [1] });
    abort.abort(); signalled = options.signal.aborted; options.signal.throwIfAborted();
  });
  translator.start = async () => {}; translator.close = () => { stopped++; };
  await assert.rejects(translator.translate(request, abort.signal)); assert.equal(signalled, true); assert.equal(stopped, 0);
});

test('source echo is counted before inference so impossible output is refused without generating', async () => {
  let tokenCalls = 0, generations = 0;
  const translator = new LocalTranslator({ localContextSize: 8192 }, async url => {
    if (url.endsWith('/tokenize')) return Response.json({ tokens: Array(++tokenCalls === 1 ? 1000 : 7000).fill(1) });
    generations++; return stream(output);
  });
  translator.start = async () => {};
  await assert.rejects(translator.translate(request), /context/);
  assert.ok(tokenCalls >= 2); assert.equal(generations, 0);
});

test('the context size reported by a running model server overrides the configured one', async () => {
  const translator = new LocalTranslator({ localContextSize: 1024 }, async url => {
    if (url.endsWith('/health')) return new Response('ok');
    if (url.endsWith('/props')) return Response.json({ default_generation_settings: { n_ctx: 16384 } });
    if (url.endsWith('/tokenize')) return Response.json({ tokens: [1, 2] });
    return stream(output);
  });
  assert.equal((await translator.translate(request)).length, 2); assert.equal(translator.contextSize, 16384);
});

test('batches preserve every timing and ID, carry neighboring context and previous translations, and report total progress', async () => {
  const cues = Array.from({length: 5}, (_,i) => ({id:`cue-${i}`,text:`Dialogue ${i}`,start:i*2,end:i*2+1}));
  const translator = new LocalTranslator({localBatchSize:2});
  const batches = [], updates = [];
  translator.translateBatch = async r => {
    batches.push(r);
    return r.cues.map(c => ({sourceIds:[c.id],text:`译文${c.id}`,start:c.start,end:c.end}));
  };
  const result = await translator.translate({...request,cues},undefined,p=>updates.push(p));
  assert.deepEqual(batches.map(b=>b.cues.length),[2,2,1]);
  assert.equal(batches[0].batchContext.after[0],'Dialogue 2');
  assert.equal(batches[1].batchContext.before[1].translation,'译文cue-1');
  assert.deepEqual(result.map(s=>s.sourceIds[0]),cues.map(c=>c.id));
  assert.deepEqual(result.map(s=>[s.start,s.end]),cues.map(c=>[c.start,c.end]));
  assert.equal(updates.at(-1).completedCues,5); assert.equal(updates.at(-1).totalBatches,3);
});

test('cancelling between batches stops all remaining work; a batch failing every retry and split returns no partial result', async () => {
  const cues = [...request.cues,{id:'c',text:'Bye.',start:5,end:6}];
  const translator = new LocalTranslator({localBatchSize:1});
  const controller = new AbortController(); let calls=0;
  translator.translateBatch = async r => { calls++; controller.abort(); return [{sourceIds:[r.cues[0].id],text:'译文'}]; };
  await assert.rejects(translator.translate({...request,cues},controller.signal)); assert.equal(calls,1);
  calls=0;
  translator.translateBatch = async r => { calls++; if (r.cues[0].id==='b') throw new Error('batch failed'); return [{sourceIds:[r.cues[0].id],text:'译文'}]; };
  await assert.rejects(translator.translate({...request,cues}),/batch failed/); assert.equal(calls,3);
});

test('a failing batch is retried at a lower temperature, then split in half with neighbouring context', async () => {
  const cues = Array.from({length: 4}, (_,i) => ({id:`c${i}`,text:`Line ${i}.`,start:i*2,end:i*2+1}));
  const translator = new LocalTranslator({localBatchSize:4});
  const seen = [];
  translator.translateBatch = async (r, signal, progress, options) => {
    seen.push([r.cues.length, options.temperature]);
    if (r.cues.length > 2) throw new Error('bad batch');
    return r.cues.map(c => ({sourceIds:[c.id],text:`译${c.id}`,start:c.start,end:c.end}));
  };
  const result = await translator.translate({...request,cues});
  assert.deepEqual(seen,[[4,undefined],[4,0.2],[2,undefined],[2,undefined]]);
  assert.deepEqual(result.map(s=>s.text),['译c0','译c1','译c2','译c3']);
});

test('a retry continues after the accepted batches and writes nothing to disk', async () => {
  const cues = Array.from({length: 4}, (_,i) => ({id:`c${i}`,text:`Line ${i}.`,start:i*2,end:i*2+1}));
  const episode = {...request, cues, wholeEpisode:true};
  const translator = new LocalTranslator({localBatchSize:2});
  let fail = true; const batches = []; let accepted = [];
  translator.translateBatch = async r => {
    batches.push(r.cues[0].id);
    if (fail && r.cues[0].id === 'c2') throw new Error('stopped');
    return r.cues.map(c => ({sourceIds:[c.id],text:`译${c.id}`,start:c.start,end:c.end}));
  };
  await assert.rejects(translator.translate(episode, undefined, p => { if (p.partialSegments?.length) accepted = p.partialSegments; }),/stopped/);
  assert.deepEqual(accepted.map(s => s.sourceIds[0]), ['c0','c1']);
  fail = false; batches.length = 0; const updates = [];
  const result = await translator.translate({...episode, accepted}, undefined, p => updates.push(p));
  assert.deepEqual(batches,['c2']);
  assert.equal(updates[0].resumed,true);
  assert.deepEqual(result.map(s=>s.text),['译c0','译c1','译c2','译c3']);
  assert.equal(translator.tables.size, 0);
});

test('names are translated once and applied consistently to every batch', async () => {
  const cues = [
    {id:'1',text:'BEN: Hello, everyone.',start:0,end:1},{id:'2',text:'Ask Ben about it.',start:2,end:3},
    {id:'3',text:'I told Ben already.',start:4,end:5},{id:'4',text:'Thanks.',start:6,end:7}];
  const prompts = [];
  const translator = new LocalTranslator({localBatchSize:2}, async (url, options) => {
    if (url.endsWith('/tokenize')) return Response.json({ tokens: [1] });
    const body = JSON.parse(options.body), prompt = body.messages[0].content; prompts.push(prompt);
    if (prompt.includes('Entries:')) return stream('[1] Ben => 本');
    if (prompt.includes('[1] BEN: Hello')) return stream('[1] BEN: Hello, everyone. => BEN：大家好。\n[2] Ask Ben about it. => 去问问Ben。');
    return stream('[1] I told Ben already. => 我已经告诉本了。\n[2] Thanks. => 谢谢。');
  });
  translator.start = async () => {};
  const result = await translator.translate({...request,cues});
  assert.deepEqual(result.map(s=>s.text),['本：大家好。','去问问本。','我已经告诉本了。','谢谢。']);
  assert.match(prompts[1],/Ben translates to 本/);
  assert.equal(prompts.filter(p=>p.includes('Entries:')).length,1);
});

test('a single subtitle that keeps producing suspicious output is accepted instead of failing the episode', async () => {
  const translator = new LocalTranslator({});
  const attempts = [];
  translator.translateBatch = async (r, signal, progress, options) => {
    attempts.push(options);
    if (!options.lenient) throw Object.assign(new Error('suspicious'), { soft: true });
    return r.cues.map(c => ({ sourceIds: [c.id], text: '译文', start: c.start, end: c.end }));
  };
  const result = await translator.translate({ ...request, cues: [request.cues[0]] });
  assert.equal(result[0].text, '译文');
  assert.deepEqual(attempts.map(a => !!a.lenient), [false, false, true]);
});

test('the local model refuses languages Hy-MT2 does not support', async () => {
  const translator = new LocalTranslator({}, async () => { throw new Error('no request expected'); });
  await assert.rejects(translator.translate({ ...request, target: 'sv' }), /cannot translate into Swedish; choose Codex or Google/);
});
