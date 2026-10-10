import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/session.js';
const { TranslationSession } = globalThis.SubtitleSession;
const cues = ['a', 'b', 'c'].map((id, i) => ({ id, start: i, end: i + 1, text: id }));
const segment = (id, text) => ({ sourceIds: [id], text });
// A service that answers from a script of replies and records what it was asked.
function service(replies) {
  const asked = []; let ids = 0;
  const send = async message => { asked.push(message); if (message.type === 'cancel') return {}; const reply = replies.shift(); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(message) : reply; };
  return { asked, session: new TranslationSession({ send, wait: async () => {}, now: () => 0, id: () => 'id' + ++ids }) };
}
const where = { session: 'https://example.test/watch/1', title: 'Title' };

test('a translation is followed from the first answer to the complete text', async () => {
  const { session, asked } = service([
    { id: 'e'.repeat(64), status: 'running', segments: [segment('a', 'A1')], cursor: 1, segmentCount: 1, completedCues: 1, totalCues: 3 },
    { id: 'e'.repeat(64), status: 'running', segments: [segment('b', 'B1')], cursor: 2, segmentCount: 2, completedCues: 2, totalCues: 3 },
    { id: 'e'.repeat(64), status: 'done', segments: [], cursor: 2, segmentCount: 3, completedCues: 3, totalCues: 3 },
    { id: 'e'.repeat(64), status: 'done', segments: [segment('a', 'A2'), segment('b', 'B2'), segment('c', 'C2')], cursor: 3, segmentCount: 3, completedCues: 3, totalCues: 3 },
  ]);
  session.use(cues); await session.run(where);
  assert.equal(session.complete, true); assert.equal(session.busy, false); assert.equal(session.error, '');
  assert.deepEqual([...session.lines.values()].map(s => s.text), ['A2', 'B2', 'C2'], 'the finished text replaces the streamed lines');
  const requests = asked.filter(m => m.type !== 'cancel');
  assert.equal(requests[0].request.session, where.session); assert.equal(requests[0].request.redo, undefined);
  assert.deepEqual(requests.slice(1).map(m => m.after), [1, 2, 0]);
  await session.run(where); assert.equal(asked.filter(m => m.type !== 'cancel').length, 4, 'a complete translation asks for nothing more');
});

test('an answer for something that is no longer wanted is dropped', async () => {
  let session;
  const made = service([message => { session.use([cues[0]]); return { id: 'x', status: 'done', segments: cues.map(c => segment(c.id, 'old')), cursor: 3, segmentCount: 3 }; }]);
  session = made.session; session.use(cues);
  await session.run(where);
  assert.equal(session.lines.size, 0, 'the old track\'s lines never reach the new one'); assert.equal(session.complete, false); assert.equal(session.cues.length, 1);
  assert.equal(session.busy, false, 'and the new track is free to start');
  assert.equal(made.asked.filter(m => m.type === 'cancel').length, 2);
});

test('only what the viewer must clear pauses with Retry; everything else is tried again without asking', async () => {
  let clock = 0;
  const replies = [new Error('Cannot connect to the subtitle service'), { id: 'e'.repeat(64), status: 'error', error: 'Codex exited (1)', segments: [], cursor: 0, segmentCount: 0 },
    { id: 'e'.repeat(64), status: 'error', needsUser: true, error: 'usage limit reached', segments: [], cursor: 0, segmentCount: 0 },
    { id: 'e'.repeat(64), status: 'done', segments: cues.map(c => segment(c.id, 'ok')), cursor: 3, segmentCount: 3, completedCues: 3, totalCues: 3 }];
  const asked = [];
  const session = new TranslationSession({ send: async m => { asked.push(m.type); if (m.type === 'cancel') return {}; const r = replies.shift(); if (r instanceof Error) throw r; return r; }, wait: async () => {}, now: () => clock, id: () => 'id' });
  const requests = () => asked.filter(t => t === 'prepareEpisode').length;
  session.use(cues); await session.run(where);
  assert.equal(session.error, '', 'a lost connection is not the viewer\'s problem'); assert.equal(session.interrupted, 'Cannot connect to the subtitle service'); assert.equal(session.retryAt, 5000);
  await session.run(where); assert.equal(requests(), 1, 'it waits its turn');
  clock = 5000; await session.run(where);
  assert.equal(session.interrupted, 'Codex exited (1)'); assert.equal(session.retryAt, 5000 + 15000, 'and waits longer each time');
  clock = 20000; await session.run(where);
  assert.equal(session.error, 'usage limit reached'); assert.equal(session.interrupted, ''); assert.equal(session.retryAt, 20000 + 120000, 'even this is asked again later, in case it cleared');
  session.retry(); await session.run(where);
  assert.equal(session.complete, true); assert.equal(session.error, ''); assert.equal(requests(), 4);
});

test('a translator that needs setting up is asked again by itself', async () => {
  const { session } = service([{ status: 'awaiting-key' }]);
  session.use(cues); await session.run(where);
  assert.equal(session.awaiting, 'key'); assert.equal(session.error, ''); assert.equal(session.retryAt, 2000);
});

test('translating again clears the screen, fills it with the new lines and ends as one complete set', async () => {
  const done = text => ({ id: 'f'.repeat(64), status: 'done', segments: cues.map(c => segment(c.id, text + c.id)), cursor: 3, segmentCount: 3, completedCues: 3, totalCues: 3 });
  const { session, asked } = service([done('old-'),
    { id: 'r'.repeat(64), status: 'running', segments: [segment('a', 'new-a')], cursor: 1, segmentCount: 1, completedCues: 1, totalCues: 3 },
    { id: 'r'.repeat(64), status: 'done', segments: [], cursor: 1, segmentCount: 3, completedCues: 3, totalCues: 3 },
    { ...done('new-'), id: 'r'.repeat(64) }]);
  const fresh = new TranslationSession({ send: async () => ({}), id: () => 'x' });
  assert.equal(fresh.again(), false, 'nothing to translate again before a translation exists');
  session.use(cues); await session.run(where);
  assert.equal(session.again(), true); assert.equal(session.complete, false);
  assert.equal(session.lines.size, 0, 'the old lines leave the screen at once'); assert.equal(session.translated, 0);
  await session.run(where);
  const request = asked.filter(m => m.type === 'prepareEpisode')[1].request;
  assert.match(request.redo, /^id\d+$/); assert.notEqual(request.epoch, asked.find(m => m.type === 'prepareEpisode').request.epoch);
  assert.equal(session.complete, true); assert.equal(session.redo, ''); assert.equal(session.translated, 3);
  assert.deepEqual([...session.lines.values()].map(s => s.text), ['new-a', 'new-b', 'new-c']);
});

test('a second translation that stops brings the previous subtitles back and says why', async () => {
  const stored = { id: 'f'.repeat(64), status: 'done', cached: true, segments: cues.map(c => segment(c.id, 'old-' + c.id)), cursor: 3, segmentCount: 3, completedCues: 3, totalCues: 3 };
  const { session, asked } = service([stored,
    { id: 'r'.repeat(64), status: 'running', segments: [segment('a', 'new-a')], cursor: 1, segmentCount: 1, completedCues: 1, totalCues: 3 },
    { id: 'r'.repeat(64), status: 'error', needsUser: true, error: 'usage limit', segments: [], cursor: 1, segmentCount: 1 },
    stored]);
  session.use(cues); await session.run(where);
  session.again(); await session.run(where);
  assert.equal(session.redo, ''); assert.equal(session.stopped, 'usage limit'); assert.equal(session.error, '', 'not a paused translation');
  assert.equal(session.lines.size, 0); assert.equal(session.busy, false);
  await session.run(where);
  const last = asked.filter(m => m.type === 'prepareEpisode').at(-1).request;
  assert.equal(last.redo, undefined, 'the stored record is asked for, not another attempt');
  assert.equal(session.complete, true); assert.deepEqual([...session.lines.values()].map(s => s.text), ['old-a', 'old-b', 'old-c']);
  assert.equal(session.stopped, 'usage limit', 'the reason stays until the next change');
  assert.equal(session.again(), true); assert.equal(session.stopped, '');
});
