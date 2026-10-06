import { loadConfig } from '../service/config.mjs';
const config = await loadConfig();
async function api(route, body) {
  const r = await fetch(`http://127.0.0.1:${config.port}${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.pairingToken}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
}
const request = { provider: 'local', target: 'zh-CN', title: 'Local service integration check', session: 'local-service-check', client: 'local-service-check', epoch: String(Date.now()), cues: [
  { id: '1', start: 0, end: 4, text: "I'm going on stage in five minutes." },
  { id: '2', start: 4, end: 6, text: 'Break a leg!' },
  { id: '3', start: 6, end: 9, text: 'Thanks. I needed that.' }
] };
const start = Date.now();
let result = await api('/episodes', request);
while (['queued', 'running'].includes(result.status)) {
  if (Date.now() - start > 240000) { await api('/cancel', { client: request.client }); throw new Error('Integration check timed out'); }
  await new Promise(resolve => setTimeout(resolve, 1000)); result = await api(`/episodes/${result.id}`);
}
if (result.status !== 'done' || result.segments.length !== 3) throw new Error(result.error || 'Incomplete result');
// Different cue IDs and session must still find the content hash in SQLite.
const reused = await api('/episodes', { ...request, session: 'local-service-cache-check', cues: request.cues.map(c => ({ ...c, id: `new-${c.id}` })) });
if (!reused.cached || reused.status !== 'done' || reused.segments[0].sourceIds[0] !== 'new-1') throw new Error('Persistent content cache failed');
console.log(JSON.stringify({ elapsedSeconds: (Date.now() - start) / 1000, result: result.segments, cacheHit: reused.cached }, null, 2));
await api('/cancel', { client: request.client });
