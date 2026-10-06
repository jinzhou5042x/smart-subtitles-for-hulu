import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexTranslator } from '../service/codex.mjs';
import { segmentStream } from '../service/translation.mjs';
const request = { cues: [{ id: 'a', start: 0, end: 2, text: 'Hello' }], context: [], target: 'zh-CN' };
test('episode transport uses one thread and one turn with fixed output keys', async () => {
  const translator = mock([{ method: 'item/completed', params: { item: { type: 'agentMessage', text: '{"translations":{"0–2":{"source":"Hello","translation":"你好"}}}' } } }, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
  const rpc = translator.rpc;
  translator.rpc = (method, params) => {
    if (method === 'turn/start') {
      const input = JSON.parse(params.input[0].text);
      assert.deepEqual(input.cues, [{timestamp:'0–2',source:'Hello'}]);
      assert.deepEqual(params.outputSchema.properties.translations.required, ['0–2']);
    }
    return rpc(method, params);
  };
  assert.equal((await translator.translateEpisode(request))[0].text, '你好');
  assert.equal(translator.listenerCount('notification'), 0);
  const failed = mock([{ method: 'item/agentMessage/delta', params: { delta: '{"translations":{"0–2":{"source":"Hello","translation":"你好"}}}' } }, { method: 'turn/completed', params: { turn: { status: 'failed' } } }]);
  await assert.rejects(failed.translateEpisode(request), /failed/);
});
function mock(events) {
  const translator = new CodexTranslator({ translationTimeoutMs: 1000 });
  translator.start = async () => {};
  translator.rpc = async method => {
    if (method === 'thread/start') return { thread: { id: 't' }, model: 'test-model' };
    if (method === 'turn/start') { setTimeout(() => { for (const event of events) translator.emit('notification', { ...event, params: { threadId: 't', ...event.params } }); }, 0); return { turn: { id: 'u' } }; }
    return {};
  };
  return translator;
}
test('Codex reports received output separately from final validated completion', async () => {
  const text = JSON.stringify({ segments: [{ i: 1, s: 'Hello', t: '你好' }] });
  const translator = mock([{ method: 'item/agentMessage/delta', params: { delta: text } }, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
  const progress = [];
  const result = await translator.translate(request, undefined, p => progress.push(p));
  assert.equal(result[0].text, '你好');
  assert.ok(progress.some(p => p.phase === 'receiving' && p.outputChars === text.length));
  assert.equal(progress.at(-1).phase, 'validating');
});
test('Codex terminal errors end the task without waiting for the long timeout', async () => {
  const translator = mock([{ method: 'error', params: { willRetry: false, error: { message: 'Disconnected' } } }]);
  await assert.rejects(translator.translate(request), /Disconnected/);
  assert.equal(translator.listenerCount('notification'), 0);
});

test('Codex gets numbered subtitles without times; each returned number takes its source timestamps', async () => {
  const cues = [{ id: '15yxg91', start: 0, end: 1, text: 'I have' }, { id: '1n0k75q', start: 1.1, end: 2, text: 'a dog.' }];
  let prompt;
  const output = { segments: [{ i: 1, s: 'I have', t: '我有' }, { i: 2, s: 'a dog.', t: '一条狗。' }] };
  const translator = mock([{ method: 'item/agentMessage/delta', params: { delta: JSON.stringify(output) } }, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
  const rpc = translator.rpc, progress = [];
  translator.rpc = async (method, params) => { if (method === 'turn/start') prompt = JSON.parse(params.input[0].text); return rpc(method, params); };
  const result = await translator.translate({ ...request, cues }, undefined, p => progress.push(p));
  assert.deepEqual(prompt.cuesToTranslate, [{ i: 1, text: 'I have' }, { i: 2, text: 'a dog.' }]);
  assert.deepEqual(result.map(r => [r.sourceIds, r.start, r.end, r.text]), [[['15yxg91'], 0, 1, '我有'], [['1n0k75q'], 1.1, 2, '一条狗。']]);
});

test('streamed objects are extracted as soon as each closes, regardless of chunk boundaries', () => {
  const text = JSON.stringify({ segments: [{ i: 1, t: '他说："}{[ ]"' }, { i: 2, t: '好\\的' }] });
  for (const size of [1, 3, 7, text.length]) {
    const feed = segmentStream(), found = [];
    for (let k = 0; k < text.length; k += size) found.push(...feed(text.slice(k, k + size)));
    assert.deepEqual(found, JSON.parse(text).segments);
  }
});

test('each numbered translation is shown with its source timestamps while the rest is still streaming', async () => {
  const cues = ['Hello', 'there', 'friend'].map((text, n) => ({ id: 'c' + n, start: n * 2, end: n * 2 + 1, text }));
  const text = JSON.stringify({ segments: cues.map((c, n) => ({ i: n + 1, s: c.text, t: '译' + n })) });
  const deltas = text.match(/[\s\S]{1,7}/g).map(delta => ({ method: 'item/agentMessage/delta', params: { delta } }));
  const translator = mock([...deltas, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
  const shown = [];
  await translator.translate({ ...request, cues }, undefined, p => { if (p.partialSegments) shown.push(p.partialSegments); });
  assert.deepEqual([...new Set(shown.map(s => s.length))], [1, 2, 3]);
  assert.deepEqual(shown.at(-1).map(s => [s.sourceIds[0], s.start, s.end, s.text]), [['c0', 0, 1, '译0'], ['c1', 2, 3, '译1'], ['c2', 4, 5, '译2']]);
});

// Answers each turn from its prompt, so a continuation can be checked.
function scripted(answer) {
  const translator = new CodexTranslator({});
  translator.start = async () => {};
  const prompts = [];
  translator.rpc = async (method, params) => {
    if (method === 'thread/start') return { thread: { id: 't' }, model: 'test-model' };
    if (method === 'turn/start') {
      const prompt = JSON.parse(params.input[0].text); prompts.push(prompt);
      setTimeout(() => {
        translator.emit('notification', { method: 'item/agentMessage/delta', params: { threadId: 't', delta: JSON.stringify({ segments: answer(prompt, prompts.length) }) } });
        translator.emit('notification', { method: 'turn/completed', params: { threadId: 't', turn: { status: 'completed' } } });
      }, 0);
      return { turn: { id: 'u' } };
    }
    return {};
  };
  return { translator, prompts };
}
const five = ['One', 'Two', 'Three', 'Four', 'Five'].map((text, n) => ({ id: 'c' + n, start: n * 2, end: n * 2 + 1, text }));

test('after an error, only subtitles not yet accepted are sent again, with the accepted ones as context', async () => {
  const { translator, prompts } = scripted((prompt, turn) => turn === 1
    ? [{ i: 1, s: 'One', t: '一' }, { i: 2, s: 'Two', t: '二' }, { i: 4, s: 'Four', t: '四' }]
    : prompt.cuesToTranslate.map(c => ({ i: c.i, s: c.text, t: '续' + c.text })));
  const shown = [];
  const result = await translator.translate({ ...request, cues: five }, undefined, p => { if (p.partialSegments) shown.push(p.partialSegments.length); });
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1].cuesToTranslate.map(c => c.text), ['Three', 'Four', 'Five']);
  assert.deepEqual(prompts[1].contextOnly.slice(-2), [{ text: 'One', translation: '一' }, { text: 'Two', translation: '二' }]);
  assert.deepEqual(result.map(s => [s.sourceIds[0], s.start, s.text]), [['c0', 0, '一'], ['c1', 2, '二'], ['c2', 4, '续Three'], ['c3', 6, '续Four'], ['c4', 8, '续Five']]);
  assert.ok(Math.min(...shown.slice(shown.indexOf(2)))>= 2); // accepted lines never disappear
});

test('a retry resumes from accepted subtitles; an attempt without progress fails', async () => {
  const { translator, prompts } = scripted(prompt => prompt.cuesToTranslate.map(c => ({ i: c.i, s: c.text, t: '译' + c.text })));
  const accepted = [{ sourceIds: ['c0'], text: '一', start: 0, end: 1 }, { sourceIds: ['c1'], text: '二', start: 2, end: 3 }];
  const result = await translator.translate({ ...request, cues: five, accepted });
  assert.deepEqual(prompts[0].cuesToTranslate.map(c => c.text), ['Three', 'Four', 'Five']);
  assert.equal(result.length, 5); assert.equal(result[0].text, '一');
  const stuck = scripted(() => [{ i: 2, t: 'x' }]);
  await assert.rejects(stuck.translator.translate({ ...request, cues: five }), /wrong number of subtitles \(1\/5\)/);
  assert.equal(stuck.prompts.length, 1);
});

test('Codex token usage is reported per episode and adds up across attempts', async () => {
  const text = JSON.stringify({ segments: [{ i: 1, s: 'Hello', t: '你好' }] });
  const total = (input, cached, output, reasoning) => ({ tokenUsage: { total: { inputTokens: input, cachedInputTokens: cached, outputTokens: output, reasoningOutputTokens: reasoning, totalTokens: input + output }, last: {} } });
  const translator = mock([
    { method: 'thread/tokenUsage/updated', params: total(1000, 0, 0, 0) },
    { method: 'thread/tokenUsage/updated', params: total(1000, 0, 300, 40) },
    { method: 'item/agentMessage/delta', params: { delta: text } }, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
  const progress = [];
  await translator.translate(request, undefined, p => progress.push(p));
  assert.deepEqual(progress.at(-1).usage, { input: 1000, cachedInput: 0, output: 300, reasoning: 40 });
  // Another thread's usage is ignored.
  const other = mock([{ method: 'thread/tokenUsage/updated', params: { ...total(5, 5, 5, 5), threadId: 'x' } }, { method: 'item/agentMessage/delta', params: { delta: text } }, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
  const seen = [];
  await other.translate(request, undefined, p => seen.push(p));
  assert.equal(seen.at(-1).usage, undefined);
});

test('streaming stops at a source mismatch and resumes from that cue without accepting shifted lines', async () => {
  const { translator, prompts } = scripted((prompt, turn) => turn === 1
    ? [{ i: 1, s: 'One', t: '一' }, { i: 2, s: 'Three', t: '三' }, { i: 3, s: 'Four', t: '四' }, { i: 4, s: 'Five', t: '五' }, { i: 5, s: 'Five', t: '五' }]
    : prompt.cuesToTranslate.map(c => ({ i: c.i, s: c.text, t: 'fixed-' + c.text })));
  const result = await translator.translate({ ...request, cues: five });
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1].cuesToTranslate.map(c => c.text), ['Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(result.map(s => s.text), ['一', 'fixed-Two', 'fixed-Three', 'fixed-Four', 'fixed-Five']);
});
