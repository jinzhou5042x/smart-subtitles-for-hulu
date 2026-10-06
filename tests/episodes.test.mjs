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

test('switching an unfinished provider aborts it; after completion every mode reuses the winner', async () => {
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
    const restored = await manager.submit({...request,epoch:'3'});
    assert.equal(restored.status,'done'); assert.equal(restored.cached,true); assert.equal(restored.segments[0].text,'本地译文');
    const google = await new EpisodeManager(queue,{model:'changed'},dir).submit({...request,epoch:'4'});
    assert.equal(google.status,'done'); assert.equal(google.segments[0].text,'本地译文');
    assert.deepEqual(calls,['google','local']);
  } finally { await rm(dir,{recursive:true,force:true}); }
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

test('Codex replaces a finished batch translation while still showing it; other languages translate separately', async () => {
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
    assert.notEqual(codex.status,'done'); assert.equal(codex.segments[0].text,'local-zh-CN');
    release(); await manager.episodes.get(codex.id).task;
    assert.equal(manager.get(codex.id).segments[0].text,'codex-zh-CN');
    const again = await manager.submit({...request,epoch:'3'});
    assert.equal(again.status,'done'); assert.equal(again.segments[0].text,'codex-zh-CN');
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

