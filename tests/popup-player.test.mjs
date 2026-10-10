import test from 'node:test';
import assert from 'node:assert/strict';
import { playerMessage, playerState } from '../extension/popup-player.js';

test('popup diagnostics target the main frame instead of racing child frames', async () => {
  const tab = { id: 7, url: 'https://www.disneyplus.com/play/episode' };
  const info = { video: true, total: 248, tone: 'done' };
  const tabs = {
    query: async () => [tab],
    sendMessage: async (id, message, options) => {
      assert.equal(id, 7); assert.equal(message.type, 'diagnostics');
      assert.deepEqual(options, { frameId: 0 }); return info;
    }
  };
  assert.equal(await playerMessage(tabs, { type: 'diagnostics' }), info);
});

test('a refreshing or disconnected player is not reported as an unrelated page', () => {
  for (const url of ['https://www.disneyplus.com/play/episode', 'https://www.hulu.com/watch/episode']) {
    assert.equal(playerState({ url, status: 'loading' }, null, true).status, 'Connecting to the video…');
    assert.equal(playerState({ url, status: 'complete' }, null, true).status, '');
    const loading = { video: false, status: 'Waiting for a Disney+ video', tone: 'waiting' };
    const failure = { video: false, status: 'Translation paused', detail: 'Connection failed', tone: 'error', error: 'Connection failed' };
    assert.equal(playerState({ url }, loading, true).status, '');
    assert.equal(playerState({ url }, failure, true), failure);
  }
  assert.equal(playerState({ url: 'https://example.com' }, null, true).status, 'Open a video on Hulu or Disney+');
  assert.equal(playerState(null, null, false).status, 'Bilingual subtitles are off');
});

test('missing content receivers return a disconnected state and can recover on the next poll', async () => {
  let connected = false;
  const tabs = { sendMessage: async () => { if (!connected) throw new Error('No receiver'); return { video: true }; } };
  assert.equal(await playerMessage(tabs, { type: 'diagnostics' }, { id: 1 }), null);
  connected = true;
  assert.deepEqual(await playerMessage(tabs, { type: 'diagnostics' }, { id: 1 }), { video: true });
});


test('missing receiver is reattached in the two script worlds and diagnostics retried', async () => {
  let connected = false;
  const injections = [];
  const tab = { id: 41, url: 'https://www.disneyplus.com/play/reconnect', status: 'complete' };
  const tabs = { sendMessage: async () => { if (!connected) throw new Error('No receiver'); return { video: true, total: 341 }; } };
  const scripting = { executeScript: async options => {
    injections.push(options);
    if (options.world === 'ISOLATED') connected = true;
  } };
  assert.deepEqual(await playerMessage(tabs, { type: 'diagnostics' }, tab, scripting), { video: true, total: 341 });
  assert.deepEqual(injections.map(i => i.world), ['MAIN', 'ISOLATED']);
  assert.deepEqual(injections[0].target, { tabId: 41, frameIds: [0] });
  assert.deepEqual(injections[0].files, ['sites.js', 'capture.js']);
  assert.equal(injections[1].files.at(-1), 'content.js');
  await playerMessage(tabs, { type: 'diagnostics' }, tab, scripting);
  assert.equal(injections.length, 2);
});

test('reconnect avoids unrelated pages, loading documents and non-diagnostic actions', async () => {
  const tabs = { sendMessage: async () => { throw new Error('No receiver'); } };
  const scripting = { executeScript: async () => assert.fail('Must not inject') };
  for (const tab of [
    { id: 50, url: 'https://example.com', status: 'complete' },
    { id: 51, url: 'https://www.hulu.com/watch/episode', status: 'loading' }
  ]) assert.equal(await playerMessage(tabs, { type: 'diagnostics' }, tab, scripting), null);
  assert.equal(await playerMessage(tabs, { type: 'retry' }, { id: 52, url: 'https://www.hulu.com/watch/id' }, scripting), null);
});

test('denied injection is contained and throttled instead of looping', async () => {
  let attempts = 0;
  const tabs = { sendMessage: async () => { throw new Error('No receiver'); } };
  const scripting = { executeScript: async () => { attempts++; throw new Error('Access denied'); } };
  const tab = { id: 61, url: 'https://www.hulu.com/watch/denied' };
  for (let i = 0; i < 3; i++) assert.equal((await playerMessage(tabs, { type: 'diagnostics' }, tab, scripting)).connectionIssue, true);
  assert.equal(attempts, 1);
});


test('subtitle discovery and timeout diagnostics stay out of the popup', () => {
  const tab = { url: 'https://www.disneyplus.com/play/episode' };
  for (const status of ['Looking for the episode subtitles', 'No subtitle file found for this episode']) {
    assert.deepEqual(playerState(tab, { status, detail: 'Checked 16 playback info', retry: true, total: 0 }, true), { status: '', detail: '', retry: false });
  }
  const ready = { total: 341, translated: 341, tone: 'done' };
  assert.equal(playerState(tab, ready, true), ready);
});


test('old extension permissions give update guidance, never a site-access accusation', async () => {
  const tabs = { sendMessage: async () => { throw new Error('No receiver'); } };
  const tab = { id: 71, url: 'https://www.disneyplus.com/play/example' };
  const info = await playerMessage(tabs, { type: 'diagnostics' }, tab, undefined);
  assert.equal(info.connectionIssue, true);
  assert.match(info.detail, /chrome:\/\/extensions/);
  assert.equal(playerState(tab, info, true), info);
});
