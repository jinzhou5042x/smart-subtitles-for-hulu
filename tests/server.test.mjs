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
