import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../service/config.mjs';
import { EpisodeManager } from '../service/episodes.mjs';
import { JobQueue } from '../service/jobs.mjs';
// data/ is gitignored, so a fresh clone does not have it yet.
await mkdir(path.join(root, 'data'), { recursive: true });

test('closing a tab cancels its running episode and prevents a pending submit from starting', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  let calls = 0, cancelled = 0;
  const queue = { submit() { calls++; return { id: 'job', status: 'running' }; }, get() { return { id: 'job', status: 'running' }; }, cancel() { cancelled++; } };
  const request = { client: 'tab-123-0', epoch: '1', session: 'cancel', target: 'zh-CN', context: [], cues: [{ id: 'a', start: 0, end: 1, text: 'Hello' }] };
  const manager = new EpisodeManager(queue, {}, dir);
  try {
    const pending = manager.submit(request); manager.cancelTab(123);
    assert.equal((await pending).status, 'cancelled'); assert.equal(calls, 0);
    const running = await manager.submit({ ...request, epoch: '2' });
    manager.cancelTab(123); await manager.episodes.get(running.id).task;
    assert.equal(cancelled, 1); assert.equal(manager.get(running.id).status, 'cancelled');
    assert.equal(manager.get(running.id).completedCues, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('switching an unfinished provider aborts it; a completed provider is reused only by itself', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const calls = []; let aborted = false;
  const queue = new JobQueue({ translate: async (r, signal) => {
    calls.push(r.provider);
    if (r.provider === 'google') await new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, {once:true}));
    return [{sourceIds:['a'],text:'本地译文',start:0,end:1}];
  } }, {});
  const manager = new EpisodeManager(queue,{},dir);
  const request = {client:'tab-42-0',epoch:'1',session:'switch',provider:'google',target:'zh-CN',context:[],cues:[{id:'a',start:0,end:1,text:'Hello'}]};
  try {
    const first = await manager.submit(request);
    manager.cancel(request.client,'1');
    const second = await manager.submit({...request,provider:'local',epoch:'2'});
    await Promise.all([manager.episodes.get(first.id).task,manager.episodes.get(second.id).task]);
    assert.equal(aborted,true); assert.equal(manager.get(first.id).status,'cancelled');
    assert.equal(manager.get(second.id).status,'done');
    const restored = await new EpisodeManager(queue,{model:'changed'},dir).submit({...request,provider:'local',epoch:'3'});
    assert.equal(restored.status,'done'); assert.equal(restored.cached,true); assert.equal(restored.segments[0].text,'本地译文');
    // Google never finished: it starts again instead of borrowing the local result.
    const google = await manager.submit({...request,epoch:'4'});
    assert.notEqual(google.status,'done'); assert.deepEqual(google.segments,[]);
    assert.deepEqual(calls,['google','local','google']);
  } finally { manager.cancelTab(42); await rm(dir,{recursive:true,force:true}); }
});

test('one input includes the entire episode and one output preserves timing and durable cache', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const calls = [];
  const queue = { submit(r) { calls.push(r); return { status: 'done', segments: r.cues.map(c => ({ sourceIds: [c.id], text: '译文 ' + c.id, start: c.start, end: c.end })) }; }, cancel() {} };
  const cues = Array.from({ length: 75 }, (_, i) => ({ id: String(i), start: i * 3, end: i * 3 + 2, text: 'Dialogue ' + i + '.' }));
  const request = { client: 'tab', epoch: '1', session: 'episode', target: 'zh-CN', context: [], cues };
  try {
    const manager = new EpisodeManager(queue, {}, dir);
    const first = await manager.submit(request);
    await manager.episodes.get(first.id).task;
    const done = manager.get(first.id);
    assert.equal(done.status, 'done'); assert.equal(done.completedCues, 75);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls.flatMap(r => r.cues), cues);
    assert.equal(calls[0].wholeEpisode, true);
    assert.deepEqual(done.segments.map(s => [s.start, s.end]), cues.map(c => [c.start, c.end]));
    assert.equal(manager.get(first.id, 50).segments.length, 25);
    const restored = await new EpisodeManager(queue, {}, dir).submit({ ...request, session: 'another-video-url', epoch: '2', cues: cues.map(c => ({ ...c, id: 'new-' + c.id })) });
    assert.equal(restored.status, 'done'); assert.equal(calls.length, 1);
    assert.equal(restored.cached, true); assert.equal(restored.segments[0].sourceIds[0], 'new-0');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed single input is retried whole without partial results', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  let fail = true;
  const ids = [];
  const queue = { submit(r) { ids.push(r.cues[0].id); if (fail) return { status: 'error', error: 'retryable' }; return { status: 'done', segments: r.cues.map(c => ({ sourceIds: [c.id], text: '译文', start: c.start, end: c.end })) }; } };
  const request = { client: 'tab', epoch: '1', session: 'resume', target: 'zh-CN', context: [], cues: Array.from({ length: 40 }, (_, i) => ({ id: String(i), start: i * 3, end: i * 3 + 2, text: 'Line.' })) };
  try {
    const manager = new EpisodeManager(queue, {}, dir);
    const first = await manager.submit(request); await manager.episodes.get(first.id).task;
    assert.equal(manager.get(first.id).status, 'error'); assert.equal(manager.get(first.id).completedCues, 0);
    fail = false;
    const restarted = new EpisodeManager(queue, {}, dir);
    await restarted.submit(request); await restarted.episodes.get(first.id).task;
    assert.equal(restarted.get(first.id).status, 'done'); assert.deepEqual(ids, ['0', '0']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('validated batches are visible before completion but never enter the complete database on cancellation', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const cues=[{id:'a',start:0,end:1,text:'Hello'},{id:'b',start:2,end:3,text:'Bye'}];
  const partial=[{sourceIds:['a'],text:'你好',start:0,end:1}];
  const queue={submit(){return {id:'partial',status:'running',progress:{phase:'local_receiving',partialSegments:partial,completedCues:1}};},get(){return this.submit();},cancel(){}};
  const manager=new EpisodeManager(queue,{},dir);
  const request={client:'tab-partial',epoch:'1',session:'partial',provider:'local',target:'zh-CN',context:[],cues};
  try {
    const result=await manager.submit(request);
    assert.equal(result.status,'running'); assert.equal(result.completedCues,1); assert.equal(result.segments[0].text,'你好');
    assert.equal(result.progress.partialSegments,undefined);
    assert.equal(manager.database.get(request),null);
    manager.cancel(request.client,request.epoch); await manager.episodes.get(result.id).task;
    assert.equal(manager.get(result.id).status,'cancelled'); assert.equal(manager.database.get(request),null);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('Codex translates beside a finished batch translation without showing it; other languages translate separately', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const calls = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new JobQueue({ translate: async r => {
    calls.push(`${r.provider}:${r.target}`);
    if (r.provider === 'codex') await gate;
    return [{sourceIds:['a'],text:`${r.provider}-${r.target}`,start:0,end:1}];
  } }, {});
  const manager = new EpisodeManager(queue,{},dir);
  const request = {client:'tab-7-0',epoch:'1',session:'upgrade',provider:'local',target:'zh-CN',context:[],cues:[{id:'a',start:0,end:1,text:'Hello'}]};
  try {
    const local = await manager.submit(request); await manager.episodes.get(local.id).task;
    const codex = await manager.submit({...request,provider:'codex',epoch:'2'});
    assert.notEqual(codex.status,'done'); assert.deepEqual(codex.segments,[]);
    release(); await manager.episodes.get(codex.id).task;
    assert.equal(manager.get(codex.id).segments[0].text,'codex-zh-CN');
    const again = await manager.submit({...request,epoch:'3'});
    assert.equal(again.status,'done'); assert.equal(again.segments[0].text,'local-zh-CN');
    const ja = await manager.submit({...request,target:'ja',epoch:'4'}); await manager.episodes.get(ja.id).task;
    assert.equal(manager.get(ja.id).segments[0].text,'local-ja');
    assert.deepEqual(calls,['local:zh-CN','codex:zh-CN','local:ja']);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('accepted translations survive an error, are not translated again, and only the complete episode reaches the database', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const cues = ['One.', 'Two.', 'Three.'].map((text, i) => ({ id: 'c' + i, start: i * 2, end: i * 2 + 1, text }));
  const requests = []; let attempt = 0;
  const queue = new JobQueue({ translate: async (r, signal, progress) => {
    requests.push(r.accepted.map(s => s.sourceIds[0]));
    if (++attempt === 1) {
      progress({ phase: 'receiving', partialSegments: [{ sourceIds: ['c0'], text: '一', start: 0, end: 1 }] });
      await new Promise(resolve => setTimeout(resolve, 450));
      throw new Error('stopped');
    }
    return [...r.accepted, { sourceIds: ['c1'], text: '二', start: 2, end: 3 }, { sourceIds: ['c2'], text: '三', start: 4, end: 5 }];
  } }, {});
  const manager = new EpisodeManager(queue, {}, dir);
  const request = { client: 'tab-5-0', epoch: '1', session: 'resume', provider: 'codex', target: 'zh-CN', context: [], cues };
  try {
    const first = await manager.submit(request); await manager.episodes.get(first.id).task;
    const failed = manager.get(first.id);
    assert.equal(failed.status, 'error'); assert.deepEqual(failed.segments.map(s => s.text), ['一']);
    assert.equal(manager.database.get(request), null);
    assert.deepEqual((await readdir(dir)).filter(name => !name.startsWith('subtitles.sqlite')), []);
    await manager.submit({ ...request, epoch: '2' }); await manager.episodes.get(first.id).task;
    assert.deepEqual(requests, [[], ['c0']]);
    assert.deepEqual(manager.get(first.id).segments.map(s => s.text), ['一', '二', '三']);
    assert.deepEqual(manager.database.get(request).map(s => s.text), ['一', '二', '三']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('progress is found by subtitle hash: after a closed tab or reload, another page resumes after the accepted subtitles', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const cues = ['One.', 'Two.', 'Three.'].map((text, i) => ({ id: 'c' + i, start: i * 2, end: i * 2 + 1, text }));
  const sent = []; let attempt = 0;
  const queue = new JobQueue({ translate: async (r, signal, progress) => {
    sent.push(r.accepted.map(s => s.sourceIds[0]));
    if (++attempt === 1) {
      progress({ phase: 'receiving', partialSegments: [{ sourceIds: [r.cues[0].id], text: '一', start: 0, end: 1 }] });
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    }
    return [...r.accepted, ...r.cues.slice(r.accepted.length).map((c, i) => ({ sourceIds: [c.id], text: ['二', '三'][i], start: c.start, end: c.end }))];
  } }, {});
  const manager = new EpisodeManager(queue, {}, dir);
  const request = { client: 'tab-8-0', epoch: '1', session: 'https://www.hulu.com/watch/abc', provider: 'codex', target: 'zh-CN', context: [], cues };
  try {
    const first = await manager.submit(request);
    await new Promise(resolve => setTimeout(resolve, 450));
    manager.cancelTab(8); await manager.episodes.get(first.id).task;
    assert.equal(manager.get(first.id).status, 'cancelled'); assert.equal(manager.database.get(request), null);
    // A new tab, another URL and new cue IDs: same subtitles, so the same hash.
    const again = { ...request, client: 'tab-9-0', epoch: '7', session: 'https://www.hulu.com/watch/abc?t=1', cues: cues.map(c => ({ ...c, id: 'n' + c.id })) };
    const second = await manager.submit(again); await manager.episodes.get(second.id).task;
    assert.deepEqual(sent, [[], ['nc0']]);
    assert.deepEqual(manager.get(second.id).segments.map(s => s.text), ['一', '二', '三']);
    assert.deepEqual(manager.database.partial(again), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('accepted lines are stored as they arrive and a restarted service resumes after them', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const cues = ['One.', 'Two.', 'Three.'].map((text, i) => ({ id: 'c' + i, start: i * 2, end: i * 2 + 1, text }));
  const sent = [];
  const stuck = new JobQueue({ translate: async (r, signal, progress) => {
    sent.push(r.accepted.length);
    progress({ phase: 'receiving', partialSegments: [{ sourceIds: ['c0'], text: '一', start: 0, end: 1 }] });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
  } }, {});
  const request = { client: 'x-tab-1-0', epoch: '1', session: 's', provider: 'codex', target: 'zh-CN', context: [], cues };
  try {
    const before = new EpisodeManager(stuck, {}, dir);
    const first = await before.submit(request);
    await new Promise(resolve => setTimeout(resolve, 300));
    // Saved while still running, before any cancellation or error.
    assert.deepEqual(before.database.partial(request).map(s => s.text), ['一']);
    assert.equal(before.database.get(request), null);
    before.cancel(request.client); await before.episodes.get(first.id).task;
    const restarted = new EpisodeManager(new JobQueue({ translate: async r => { sent.push(r.accepted.length); return [...r.accepted, ...r.cues.slice(1).map(c => ({ sourceIds: [c.id], text: c.text, start: c.start, end: c.end }))]; } }, {}), {}, dir);
    const again = await restarted.submit({ ...request, epoch: '2' }); await restarted.episodes.get(again.id).task;
    assert.deepEqual(sent, [0, 1]);
    assert.deepEqual(restarted.get(again.id).segments.map(s => s.text), ['一', 'Two.', 'Three.']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('tokens of interrupted runs are kept and added to the complete translation', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const cues = ['One.', 'Two.'].map((text, i) => ({ id: 'c' + i, start: i * 2, end: i * 2 + 1, text }));
  let attempt = 0;
  const queue = new JobQueue({ translate: async (r, signal, progress) => {
    if (++attempt === 1) {
      progress({ phase: 'receiving', usage: { input: 1000, cachedInput: 0, output: 50, reasoning: 0 }, partialSegments: [{ sourceIds: ['c0'], text: '一', start: 0, end: 1 }] });
      await new Promise(resolve => setTimeout(resolve, 300));
      throw new Error('usage limit');
    }
    progress({ phase: 'receiving', usage: { input: 900, cachedInput: 800, output: 40, reasoning: 5 } });
    await new Promise(resolve => setTimeout(resolve, 300));
    return [...r.accepted, { sourceIds: ['c1'], text: '二', start: 2, end: 3 }];
  } }, {});
  const request = { client: 'tab-1-0', epoch: '1', session: 's', provider: 'codex', target: 'zh-CN', context: [], cues };
  try {
    const manager = new EpisodeManager(queue, {}, dir);
    const first = await manager.submit(request); await manager.episodes.get(first.id).task;
    assert.equal(manager.get(first.id).status, 'error');
    assert.deepEqual(manager.get(first.id).usage, { input: 1000, cachedInput: 0, output: 50, reasoning: 0 });
    // A restarted service continues the count.
    const restarted = new EpisodeManager(queue, {}, dir);
    const second = await restarted.submit({ ...request, epoch: '2' }); await restarted.episodes.get(second.id).task;
    const total = { input: 1900, cachedInput: 800, output: 90, reasoning: 5 };
    assert.equal(restarted.get(second.id).status, 'done'); assert.deepEqual(restarted.get(second.id).usage, total);
    const loaded = await new EpisodeManager(queue, {}, dir).submit({ ...request, epoch: '3' });
    assert.equal(loaded.cached, true); assert.deepEqual(loaded.usage, total);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('16 videos translate at once; closing one tab stops only its translation and a reload resumes it', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const episode = k => ['One.', 'Two.', 'Three.'].map((text, i) => ({ id: `${k}-${i}`, start: i * 2, end: i * 2 + 1, text: `Video ${k}: ${text}` }));
  let active = 0, peak = 0; const aborted = [], resumedFrom = [];
  const queue = new JobQueue({ translate: async (r, signal, progress) => {
    active++; peak = Math.max(peak, active);
    try {
      if (r.accepted.length) { resumedFrom.push(r.accepted.length); return [...r.accepted, ...r.cues.slice(r.accepted.length).map(c => ({ sourceIds: [c.id], text: '译' + c.id, start: c.start, end: c.end }))]; }
      progress({ phase: 'receiving', partialSegments: [{ sourceIds: [r.cues[0].id], text: '译' + r.cues[0].id, start: 0, end: 1 }] });
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted.push(r.cues[0].id); reject(new Error('cancelled')); }, { once: true }));
    } finally { active--; }
  } }, { maxAgents: 16 });
  const manager = new EpisodeManager(queue, { maxAgents: 16 }, dir);
  const request = k => ({ client: `tab-${k}-0`, epoch: '1', session: `https://www.hulu.com/watch/${k}`, provider: 'codex', target: 'zh-CN', context: [], cues: episode(k) });
  try {
    // One at a time, so video 16 is the one that reaches the queue last and waits.
    const opened = [];
    for (let k = 0; k < 17; k++) opened.push(await manager.submit(request(k)));
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(queue.running, 16); assert.equal(peak, 16);
    assert.equal(manager.get(opened[16].id).status, 'queued');
    // Close tab 3: only its translation stops; its first line is saved.
    manager.cancelTab(3); await manager.episodes.get(opened[3].id).task;
    assert.deepEqual(aborted, ['3-0']); assert.equal(manager.get(opened[3].id).status, 'cancelled');
    assert.deepEqual(manager.database.partial(request(3)).map(s => s.text), ['译3-0']);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(manager.get(opened[16].id).status, 'running'); // the waiting video took the free slot
    // Reload tab 3: all 16 slots are busy, so it waits; when tab 5 closes it resumes after the saved line.
    const reloaded = await manager.submit({ ...request(3), epoch: '2' });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(manager.get(reloaded.id).status, 'queued'); assert.deepEqual(resumedFrom, []);
    manager.cancelTab(5); await manager.episodes.get(reloaded.id).task;
    assert.deepEqual(resumedFrom, [1]);
    assert.deepEqual(manager.get(reloaded.id).segments.map(s => s.text), ['译3-0', '译3-1', '译3-2']);
    for (let k = 0; k < 17; k++) if (k !== 3) manager.cancelTab(k);
    await Promise.all([...manager.episodes.values()].map(e => e.task));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('each translator keeps its own result and progress; switching never shows another translator\'s lines', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const calls = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new JobQueue({ translate: async r => {
    calls.push(r.provider);
    if (r.provider === 'codex') await gate;
    return [{sourceIds:['a'],text:`${r.provider} line`,start:0,end:1}];
  } }, {});
  const manager = new EpisodeManager(queue,{},dir);
  const request = {client:'tab-9-0',epoch:'1',session:'own',provider:'google',target:'zh-CN',context:[],cues:[{id:'a',start:0,end:1,text:'Hello'}]};
  try {
    const google = await manager.submit(request); await manager.episodes.get(google.id).task;
    assert.equal(manager.get(google.id).segments[0].text,'google line');
    // Codex has no result yet: nothing of Google's may be shown as Codex's, cached or as a preview.
    const codex = await manager.submit({...request,provider:'codex',epoch:'2'});
    assert.notEqual(codex.status,'done'); assert.equal(codex.cached,false); assert.deepEqual(codex.segments,[]);
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.deepEqual(manager.get(codex.id).segments,[]);
    release(); await manager.episodes.get(codex.id).task;
    assert.equal(manager.get(codex.id).segments[0].text,'codex line');
    // Switching back restores Google's own stored result, without translating again.
    const fresh = new EpisodeManager(queue,{},dir);
    const back = await fresh.submit({...request,epoch:'3'});
    assert.equal(back.status,'done'); assert.equal(back.cached,true); assert.equal(back.segments[0].text,'google line');
    const again = await fresh.submit({...request,provider:'codex',epoch:'4'});
    assert.equal(again.status,'done'); assert.equal(again.segments[0].text,'codex line');
    assert.deepEqual(calls,['google','codex']);
  } finally { release(); manager.cancelTab(9); await rm(dir,{recursive:true,force:true}); }
});

test('translating an episode again runs the translator, serves the old lines until it is done, and survives a failure', async () => {
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  let round = 0, fail = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new JobQueue({ translate: async r => {
    round++;
    if (r.redo && fail) { fail = false; throw new Error('usage limit'); }
    if (r.redo) await gate;
    return [{ sourceIds: ['a'], text: `round ${round}`, start: 0, end: 1 }];
  } }, {});
  const manager = new EpisodeManager(queue, {}, dir);
  const request = { client: 'tab-3-0', epoch: '1', session: 'again', provider: 'codex', target: 'zh-CN', context: [], cues: [{ id: 'a', start: 0, end: 1, text: 'Hello' }] };
  const redo = { ...request, redo: '22222222-2222-4222-8222-222222222222' };
  try {
    const first = await manager.submit(request); await manager.episodes.get(first.id).task;
    assert.equal(manager.get(first.id).segments[0].text, 'round 1');
    const failed = await manager.submit({ ...redo, epoch: '2' }); await manager.episodes.get(failed.id).task;
    assert.notEqual(failed.id, first.id); assert.equal(manager.get(failed.id).status, 'error');
    assert.equal(manager.database.get(request)[0].text, 'round 1', 'a failed redo leaves the subtitles in use');
    const again = await manager.submit({ ...redo, epoch: '3' });
    assert.equal(again.id, failed.id); assert.notEqual(again.status, 'done');
    assert.equal((await new EpisodeManager(queue, {}, dir).submit({ ...request, epoch: '4' })).segments[0].text, 'round 1', 'other pages keep the old lines meanwhile');
    release(); await manager.episodes.get(again.id).task;
    assert.equal(manager.get(again.id).status, 'done'); assert.equal(manager.get(again.id).segments[0].text, 'round 3');
    assert.equal(manager.database.get(request)[0].text, 'round 3');
    const late = await manager.submit({ ...redo, epoch: '5' });
    assert.equal(late.status, 'done'); assert.equal(round, 3, 'the same attempt is not translated twice');
  } finally { release(); manager.cancelTab(3); await rm(dir, { recursive: true, force: true }); }
});

test('an episode says whether its failure needs the viewer: accounts and quotas do, a model slip or a crash does not', async () => {
  const { needsViewer } = await import('../service/episodes.mjs');
  for (const message of ["You've hit your usage limit. Try again at 3:40 PM.", 'unexpected status 401 Unauthorized', 'Not logged in', 'Link your Google API key file in the extension', 'Google Translate request failed (HTTP 403); check the API key, that the API is enabled, and the quota', 'The codex translator is not enabled']) assert.equal(needsViewer(message), true, message);
  for (const message of ['Subtitle 507.174–510.427 does not match its original source (different text)', 'Codex exited (1)', 'Translation timed out', 'Codex turn/start timed out', 'stream disconnected before completion', 'Episode task expired']) assert.equal(needsViewer(message), false, message);
  const dir = await mkdtemp(path.join(root, 'data/test-episodes-'));
  const failing = message => new JobQueue({ translate: async () => { throw new Error(message); } }, {});
  const request = { client: 'tab-6-0', epoch: '1', session: 'kind', provider: 'codex', target: 'zh-CN', context: [], cues: [{ id: 'a', start: 0, end: 1, text: 'Hello' }] };
  try {
    for (const [message, expected] of [['Codex exited (1)', false], ['usage limit reached', true]]) {
      const manager = new EpisodeManager(failing(message), {}, dir);
      const episode = await manager.submit({ ...request, session: message }); await manager.episodes.get(episode.id).task;
      assert.equal(manager.get(episode.id).status, 'error'); assert.equal(manager.get(episode.id).needsUser, expected, message);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
