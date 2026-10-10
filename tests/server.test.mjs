import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../service/server.mjs';
test('local service refuses web origins, wrong tokens and spoofed Host', async () => {
  const config = { port: 43128, pairingToken: 'test-token' };
  const q = { jobs: new Map(), running: false };
  const server = createServer(config, q);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  const url = `http://127.0.0.1:${config.port}`;
  try {
    assert.equal((await fetch(url + '/health')).status, 200);
    assert.equal((await fetch(url + '/status')).status, 401);
    assert.equal((await fetch(url + '/status', { headers: { Authorization: 'Bearer test-token', Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(url + '/status', { headers: { Authorization: 'Bearer test-token', Origin: 'chrome-extension://' + 'a'.repeat(32) } })).status, 200);
    const status = await new Promise((resolve, reject) => { const req = http.get(url + '/status', { headers: { Authorization: 'Bearer test-token', Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
    assert.equal(status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('only enabled translators are offered and accepted; extension IDs can be restricted', async () => {
  const allowed = 'a'.repeat(32), other = 'b'.repeat(32);
  const config = { port: 0, pairingToken: 'test-token', providers: ['codex'], allowedExtensionIds: [allowed] };
  const submitted = [];
  const server = createServer(config, { jobs: new Map(), running: false }, { submit: async r => { submitted.push(r.provider); return { status: 'queued' }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  const url = `http://127.0.0.1:${config.port}`, auth = { Authorization: 'Bearer test-token' };
  const episode = provider => fetch(url + '/episodes', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, target: 'es', session: 's', client: 'c', epoch: '1', cues: [{ id: 'a', start: 0, end: 1, text: 'Hi' }] }) });
  try {
    assert.deepEqual((await (await fetch(url + '/status', { headers: auth })).json()).providers, ['codex']);
    assert.equal((await episode('codex')).status, 202);
    const google = await episode('google');
    assert.equal(google.status, 400); assert.match((await google.json()).error, /not enabled/);
    assert.deepEqual(submitted, ['codex']);
    assert.equal((await fetch(url + '/status', { headers: { ...auth, Origin: 'chrome-extension://' + allowed } })).status, 200);
    assert.equal((await fetch(url + '/status', { headers: { ...auth, Origin: 'chrome-extension://' + other } })).status, 403);
    assert.equal((await fetch(url + '/health')).headers.get('x-frame-options'), 'DENY');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('status reports whether Codex can translate, re-asking often while it cannot and rarely while it can', async () => {
  const { CodexAccount } = await import('../service/codex-account.mjs');
  let clock = 0, answer = 'signed-out', asked = 0;
  const account = new CodexAccount({}, async () => { asked++; return answer; }, () => clock);
  assert.equal(account.get(), 'unknown'); await account.pending;
  assert.equal(account.get(), 'signed-out'); assert.equal(asked, 1);
  clock = 4000; account.get(); assert.equal(asked, 1, 'not more than once in five seconds');
  answer = 'ready'; clock = 6000; account.get(); await account.pending;
  assert.equal(account.get(), 'ready', 'a sign-in shows within seconds'); assert.equal(asked, 2);
  clock = 200000; account.get(); assert.equal(asked, 2);
  clock = 400000; account.get(); await account.pending; assert.equal(asked, 3);
  const config = { port: 0, pairingToken: 'test-token', providers: ['codex'] };
  const server = createServer(config, { jobs: new Map(), running: false }, null, account);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  try { assert.equal((await (await fetch(`http://127.0.0.1:${config.port}/status`, { headers: { Authorization: 'Bearer test-token' } })).json()).codex, 'ready'); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('a Codex that is not on this computer is reported as missing, not as signed out', async () => {
  const { codexLoginStatus } = await import('../service/codex-account.mjs');
  assert.equal(await codexLoginStatus({ codexPath: '/nonexistent/folder/codex' }), 'missing');
  assert.equal(await codexLoginStatus({ codexPath: 'no-such-codex-command-anywhere' }), 'missing');
});

test('a Codex login can always be opened again, cancelled, or left to end; logging out runs Codex\'s own command', async () => {
  const { CodexAccount, codexSignIn } = await import('../service/codex-account.mjs');
  let answer = 'signed-out'; const attempts = [];
  // Each login attempt: `finish(problem)` ends it as Codex would, `cancelled` records a cancel.
  const signIn = () => { const attempt = { cancelled: false }; attempt.done = new Promise(resolve => { attempt.finish = resolve; }); attempt.cancel = () => { attempt.cancelled = true; attempt.finish('cancelled'); }; attempts.push(attempt); return attempt; };
  const order = [];
  const account = new CodexAccount({}, async () => answer, Date.now, signIn, async () => { order.push('logout'); answer = 'signed-out'; });
  account.onAccountChange = () => order.push('drop');
  const config = { port: 0, pairingToken: 'test-token', providers: ['codex'] };
  const server = createServer(config, { jobs: new Map(), running: false }, null, account);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  const url = `http://127.0.0.1:${config.port}`, auth = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const post = async (action, headers = auth) => { const r = await fetch(`${url}/settings/codex/${action}`, { method: 'POST', headers, body: '{"command":"rm"}' }); return r.status === 202 ? r.json() : r.status; };
  const state = async () => (await (await fetch(url + '/status', { headers: auth })).json()).codexSignIn;
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    assert.equal(await post('sign-in', {}), 401, 'the pairing code is required');
    assert.equal((await post('sign-in')).signingIn, true);
    // The viewer closed the ChatGPT page and comes back: the login is still waiting, and can be opened again.
    assert.equal((await state()).signingIn, true);
    await post('sign-in'); assert.equal(attempts.length, 2); assert.equal(attempts[0].cancelled, true, 'the first one is ended, not left behind');
    assert.equal((await state()).signingIn, true);
    // Or cancelled: nothing is left waiting and nothing is reported as a failure.
    await post('cancel'); await settle();
    assert.equal(attempts[1].cancelled, true); assert.deepEqual(await state(), { status: 'signed-out', signingIn: false });
    // One that ends without a login says so; one that succeeds makes the service drop the old account.
    await post('sign-in'); attempts[2].finish('The sign-in page was not completed in time'); await settle();
    assert.deepEqual(await state(), { status: 'signed-out', signingIn: false, error: 'The sign-in page was not completed in time' });
    await post('sign-in'); answer = 'ready'; attempts[3].finish(''); await settle();
    assert.deepEqual(await state(), { status: 'ready', signingIn: false }); assert.deepEqual(order, ['drop']);
    assert.deepEqual(await post('sign-out'), { status: 'signed-out', signingIn: false }); assert.deepEqual(order, ['drop', 'logout', 'drop']);
    assert.equal(await post('switch'), 404, 'there is no other account action');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  // The command is fixed (`codex login`, no argument from anywhere), it can be stopped, and it stops by itself.
  const runs = []; let killed = 0;
  const fake = exitsBy => (command, args) => { runs.push([command, ...args]); const handlers = {}; if (exitsBy === 'itself') setTimeout(() => handlers.exit(0)); return { once: (name, fn) => { handlers[name] = fn; }, kill() { killed++; setTimeout(() => handlers.exit(null)); } }; };
  assert.equal(await codexSignIn({ codexPath: 'codex' }, { run: fake('itself') }).done, '');
  assert.deepEqual(runs, [['codex', 'login']]);
  const waiting = codexSignIn({ codexPath: 'codex' }, { run: fake('never') }); waiting.cancel();
  assert.equal(await waiting.done, 'cancelled'); assert.equal(killed, 1);
  assert.equal(await codexSignIn({ codexPath: 'codex' }, { run: fake('never'), timeout: 10 }).done, 'The sign-in page was not completed in time'); assert.equal(killed, 2);
});
