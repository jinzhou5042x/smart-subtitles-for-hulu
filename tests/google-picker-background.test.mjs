import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');

test('Google sends no episode request until binding completes, including retries and unlinking', async () => {
  const local = { token: 'pairing', settingsVersion: 2, settings: { provider: 'google' } };
  const storage = data => ({ get: async names => Object.fromEntries((Array.isArray(names) ? names : [names]).map(n => [n, data[n]])), set: async next => Object.assign(data, next), setAccessLevel() {} });
  let receive;
  let status = { providers: ['codex'], googleConfigured: false };
  const episodes = [];
  const chrome = {
    storage: { local: storage(local), session: storage({}) },
    runtime: { getURL: file => 'chrome-extension://example/' + file, onMessage: { addListener(fn) { receive = fn; } } },
    tabs: { get: async () => ({ id: 1 }), onRemoved: { addListener() {} } }
  };
  vm.runInContext(source, vm.createContext({ chrome, SubtitleSites: { matches: [], identify: () => 'hulu' }, SubtitleLanguages: { defaultCode: 'zh-CN', get: () => true }, AbortSignal, fetch: async (url, options) => {
    if (url.endsWith('/status')) return new Response(JSON.stringify(status));
    assert.ok(url.endsWith('/episodes'));
    episodes.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ status: 'queued' }));
  } }));
  const prepare = () => new Promise(resolve => receive({ type: 'prepareEpisode', request: { cues: [{ text: 'Hello' }] } }, { tab: { id: 1 }, frameId: 0, url: 'https://www.hulu.com/watch/test' }, resolve));
  for (const pickerStatus of [undefined, 'pending', 'cancelled', 'error']) {
    status.googlePicker = { status: pickerStatus };
    for (let retry = 0; retry < 2; retry++) {
      const result = await prepare();
      assert.equal(result.ok, true);
      assert.equal(result.data.status, 'awaiting-key');
    }
  }
  assert.equal(episodes.length, 0);
  // A configured key alone must not bypass the companion's enablement state.
  status.googleConfigured = true;
  assert.equal((await prepare()).data.status, 'awaiting-key');
  assert.equal(episodes.length, 0);
  status.providers.push('google');
  assert.equal((await prepare()).data.status, 'queued');
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].provider, 'google');
  status.googleConfigured = false;
  assert.equal((await prepare()).data.status, 'awaiting-key');
  assert.equal(episodes.length, 1);
  // Selecting Codex is independent of Google setup.
  local.settings.provider = 'codex';
  assert.equal((await prepare()).data.status, 'queued');
  assert.equal(episodes[1].provider, 'codex');
});

for (const provider of ['google', 'codex']) for (const outcome of ['done', 'cancelled']) test(`file selection ${outcome} restores its popup and preserves chosen ${provider}, storing no key`, async () => {
  const local = { token: 'pairing', settingsVersion: 2, settings: { provider } }, session = {};
  const storage = data => ({ get: async names => Object.fromEntries((Array.isArray(names) ? names : [names]).map(n => [n, data[n]])), set: async next => Object.assign(data, next), setAccessLevel() {} });
  let receive, checks = 0; const broadcasts = [], opened = [], focused = [];
  const key = 'test_key_12345678901234567890';
  const chrome = {
    storage: { local: storage(local), session: storage(session) },
    runtime: { getURL: file => 'chrome-extension://example/' + file, onMessage: { addListener(fn) { receive = fn; } } },
    tabs: { query: async () => [{ id: 1, windowId: 2 }], getZoom: async () => 0.9, sendMessage: async (id, message) => broadcasts.push(message), onRemoved: { addListener() {} } },
    windows: { get: async () => ({ left: 2560, top: 0, width: 1800, height: 1000 }), update: async (id, value) => focused.push({ id, ...value }) },
    action: { openPopup: async value => opened.push(value) },
    scripting: { executeScript: async ({ func, args }) => [{ result: func(...args) }] }
  };
  const context = vm.createContext({ chrome, SubtitleSites: { matches: [], identify: () => false }, SubtitleLanguages: { defaultCode: 'zh-CN', get: () => true }, AbortSignal, setTimeout: fn => setTimeout(fn, 0), fetch: async (url, options) => {
    if (options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), { mode: 'load', anchor: { left: 2560, top: 0, width: 1800, height: 1000, topRatio: 0.1, heightRatio: 0.9 } });
      return new Response(JSON.stringify({ id: 'operation', status: 'pending' }));
    }
    checks++;
    return new Response(JSON.stringify({ id: 'operation', status: checks > 1 ? outcome : 'pending' }));
  } });
  context.window = { outerWidth: 1800, outerHeight: 1000, innerWidth: 2000, innerHeight: 1000 };
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  const result = await new Promise(resolve => receive({ type: 'pickGoogleKey', mode: 'load' }, { url: 'chrome-extension://example/popup.html' }, resolve));
  assert.equal(result.ok, true);
  for (let i = 0; i < 100 && !opened.length; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(session.googlePicker.status, outcome);
  assert.equal(opened.length, 1); assert.equal(opened[0].windowId, 2);
  assert.equal(focused[0].id, 2); assert.equal(focused[0].focused, true);
  assert.equal(session.googlePickerReturn, null);
  assert.equal(local.settings.provider, provider);
  if (outcome === 'done') {
    assert.equal(broadcasts.at(-1).settings.provider, provider);
    assert.equal(broadcasts.at(-1).retryProvider, 'google');
  }
  else assert.equal(broadcasts.length, 0);
  const settings = await new Promise(resolve => receive({ type: 'settings' }, { url: 'chrome-extension://example/popup.html' }, resolve));
  assert.equal(settings.data.provider, provider);
  assert.equal(JSON.stringify({ local, session }).includes(key), false);
});
