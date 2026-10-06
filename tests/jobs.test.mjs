import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../service/jobs.mjs';
const request = { client: 'tab1', epoch: '1', session: 'episode', target: 'zh-CN', cues: [{ id: 'a', start: 0, end: 2, text: 'Hello' }], context: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
test('queue cancels obsolete work and runs the next request', async () => {
  let calls = 0;
  const translator = { translate: async (r, signal) => { calls++; await delay(25); signal.throwIfAborted(); return [{ sourceIds: ['a'], text: '你好', start: 0, end: 2 }]; } };
  const q = new JobQueue(translator, {});
  const first = q.submit(request); q.cancel('tab1', '1');
  const second = q.submit({ ...request, epoch: '2' });
  await delay(120);
  assert.equal(q.get(first.id).status, 'cancelled'); assert.equal(q.get(second.id).status, 'done');
  assert.equal(q.get(second.id).segments[0].text, '你好'); assert.equal(calls, 2);
});
