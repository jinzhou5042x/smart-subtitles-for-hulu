import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleTranslator } from '../service/google.mjs';
import { cacheKey, validateRequest } from '../service/translation.mjs';
const request = { provider: 'google', client: 'a', epoch: '1', session: 'movie', target: 'zh-CN', context: [], cues: Array.from({ length: 129 }, (_, i) => ({ id: String(i), start: i * 2, end: i * 2 + 1, text: 'Hello' })) };
test('Google obeys API limits, preserves IDs and timings, and separates provider caches', async () => {
  const sizes = [];
  const google = new GoogleTranslator({ googleApiKey: 'test-only' }, async (url, options) => {
    const body = JSON.parse(options.body); sizes.push(body.q.length);
    assert.equal(body.target, 'zh-CN'); assert.equal(body.format, 'text'); assert.ok(!url.includes('test-only'));
    return { ok: true, json: async () => ({ data: { translations: body.q.map(() => ({ translatedText: '你好 &amp; 再见' })) } }) };
  });
  const result = await google.translate(request);
  assert.deepEqual(sizes, [128, 1]); assert.equal(result.length, 129);
  assert.equal(result[128].start, 256); assert.equal(result[0].text, '你好 & 再见');
  assert.notEqual(cacheKey(request, {}), cacheKey({ ...request, provider: 'codex' }, {}));
  assert.equal(validateRequest(request, 20000).provider, 'google');
});
test('Google abort stops subsequent API calls and malformed output is rejected', async () => {
  const controller = new AbortController(); let calls = 0;
  const google = new GoogleTranslator({ googleApiKey: 'test-only' }, async () => { calls++; controller.abort(); return { ok: true }; });
  await assert.rejects(google.translate(request, controller.signal)); assert.equal(calls, 1);
  const invalid = new GoogleTranslator({ googleApiKey: 'test-only' }, async () => ({ ok: true, json: async () => ({ data: { translations: [] } }) }));
  await assert.rejects(invalid.translate(request), /incomplete/);
});
