import http from 'node:http';
import { configureGoogle } from './google-settings.mjs';
import { GoogleKeyPicker } from './google-picker.mjs';
import { timingSafeEqual } from 'node:crypto';
import { readFile, appendFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, root } from './config.mjs';
import { JobQueue } from './jobs.mjs';
import { EpisodeManager } from './episodes.mjs';
import { validateRequest } from './translation.mjs';

// The version comes from package.json (scripts/version.mjs keeps it in step with the extension).
export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const isExtensionOrigin = origin => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '');
// Translators are loaded only when enabled in config.providers (the release enables Codex only).
const TRANSLATORS = {
  codex: async config => new (await import('./codex.mjs')).CodexTranslator(config),
  google: async config => new (await import('./google.mjs')).GoogleTranslator(config),
  local: async config => new (await import('./local.mjs')).LocalTranslator(config)
};
export const enabledProviders = config => (Array.isArray(config.providers) ? config.providers : ['codex']).filter(p => TRANSLATORS[p]);
export function tokenMatches(actual, expected) {
  const a = Buffer.from(actual || ''), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readJson(req, limit = 65536) {
  let bytes = 0, parts = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new Error('Request too large'); parts.push(chunk); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function createServer(config, queue, episodes, codexAccount) {
  const keyPicker = new GoogleKeyPicker(config);
  const httpServer = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Browsers may only call the service from the extension (optionally only from the IDs listed in
    // config.allowedExtensionIds); every private endpoint also requires the pairing code.
    const ids = Array.isArray(config.allowedExtensionIds) ? config.allowedExtensionIds : [];
    const allowedOrigin = !origin || (isExtensionOrigin(origin) && (!ids.length || ids.includes(origin.slice(19))));
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if (!['127.0.0.1', `127.0.0.1:${config.port}`].includes(req.headers.host)) return json(403, { error: 'Invalid host' });
    if (!allowedOrigin) return json(403, { error: 'Origin not allowed' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204); return res.end();
    }
    const url = new URL(req.url, `http://127.0.0.1:${config.port}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { app: 'hulu-context-subtitles', version, ready: true });
    // Development only: the demo clip is served when tests/fixtures exists (not in the release).
    const publicFiles = { '/demo': 'tests/fixtures/demo.html', '/demo.vtt': 'tests/fixtures/demo.vtt', '/demo.mp4': 'tests/fixtures/demo.mp4' };
    if (req.method === 'GET' && publicFiles[url.pathname] && await access(path.join(root, 'tests/fixtures')).then(() => true, () => false)) {
      try {
        const file = await readFile(path.join(root, publicFiles[url.pathname]));
        const type = url.pathname.endsWith('.mp4') ? 'video/mp4' : url.pathname.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'text/html; charset=utf-8';
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) {
          const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
          if (start > end || start >= file.length) { res.writeHead(416, { 'Content-Range': `bytes */${file.length}` }); return res.end(); }
          res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }); return res.end(file.subarray(start, end + 1));
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': file.length, 'Accept-Ranges': 'bytes' }); return res.end(file);
      } catch { return json(404, { error: 'Not found' }); }
    }
    if (!tokenMatches(req.headers.authorization, `Bearer ${config.pairingToken}`)) return json(401, { error: 'Pairing token required' });
    try {
      if (req.method === 'GET' && url.pathname === '/status') return json(200, { app: 'hulu-context-subtitles', queued: [...queue.jobs.values()].filter(j => j.status === 'queued').length, running: queue.running, maxAgents: queue.limit, model: config.model || 'Codex default model', providers: enabledProviders(config), availableProviders: [...new Set([...enabledProviders(config), 'google'])], googleConfigured: config.googleApiKeyFile !== null && !!(config.googleApiKeyFile || config.googleApiKey || process.env.GOOGLE_TRANSLATE_API_KEY), googleApiKeyFile: config.googleApiKeyFile || null, googlePicker: keyPicker.get(), ...(codexAccount && enabledProviders(config).includes('codex') ? { codex: codexAccount.get(), codexSignIn: codexAccount.describe() } : {}) });
      if (req.method === 'POST' && url.pathname === '/settings/google/picker/focus') { const { id } = await readJson(req); return json(200, keyPicker.focus(id)); }
      if (req.method === 'POST' && url.pathname === '/settings/google/picker/cancel') { const { id } = await readJson(req); return json(200, keyPicker.cancel(id)); }
      if (req.method === 'POST' && url.pathname === '/settings/google/picker') return json(202, keyPicker.start(await readJson(req, 4096)));
      if (req.method === 'GET' && url.pathname === '/settings/google/picker') return json(200, keyPicker.get(url.searchParams.get('id')));
      if (req.method === 'POST' && url.pathname === '/settings/google') {
        if (keyPicker.get()?.status === 'pending') throw new Error('Finish or cancel file selection first');
        return json(200, await configureGoogle(config, await readJson(req, 4096)));
      }
      // The Codex account, managed from the popup: fixed commands of Codex itself, no arguments.
      if (req.method === 'POST' && url.pathname.startsWith('/settings/codex/') && codexAccount && enabledProviders(config).includes('codex')) {
        const action = { 'sign-in': () => codexAccount.startSignIn(), 'sign-out': () => codexAccount.signOut(), cancel: () => codexAccount.cancelSignIn() }[url.pathname.slice(16)];
        if (action) { await action(); return json(202, codexAccount.describe()); }
      }
      if (req.method === 'POST' && url.pathname === '/episodes' && episodes) {
        const request = validateRequest(await readJson(req, 8_000_000));
        if (!enabledProviders(config).includes(request.provider)) throw new Error(`The ${request.provider} translator is not enabled`);
        return json(202, await episodes.submit(request));
      }
      if (req.method === 'GET' && /^\/episodes\/[a-f0-9]{64}$/.test(url.pathname) && episodes) { const episode = episodes.get(url.pathname.split('/')[2], url.searchParams.get('after')); return json(episode ? 200 : 404, episode || { error: 'Episode not loaded; resubmit the source subtitles' }); }
      if (req.method === 'POST' && url.pathname === '/cancel') {
        const data = await readJson(req);
        if (typeof data.client !== 'string' || !data.client || (data.epoch !== undefined && typeof data.epoch !== 'string')) throw new Error('Invalid cancellation');
        queue.cancel(data.client, data.epoch); episodes?.cancel(data.client, data.epoch); return json(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/shutdown') { json(200, { ok: true }); process.emit('SIGTERM'); return; }
      if (req.method === 'POST' && url.pathname === '/cancelTab') {
        const { tabId } = await readJson(req);
        if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Invalid tab');
        episodes?.cancelTab(tabId);
        for (const job of queue.jobs.values()) if (job.request.client.startsWith(`tab-${tabId}-`)) queue.cancel(job.request.client);
        return json(200, { ok: true });
      }
      return json(404, { error: 'Not found' });
    } catch (e) { json(400, { error: e.message }); }
  });
  httpServer.closePicker = () => keyPicker.close();
  httpServer.on('close', () => keyPicker.close());
  return httpServer;
}

async function main() {
  const config = await loadConfig();
  config.requireBinding = true;
  const { translateCheckpoints } = await import('./checkpoints.mjs');
  const { addUsage } = await import('./database.mjs');
  const { CodexAccount } = await import('./codex-account.mjs');
  const codexAccount = new CodexAccount(config); void codexAccount.refresh();
  const translators = Object.fromEntries(await Promise.all(enabledProviders(config).map(async p => [p, await TRANSLATORS[p](config)])));
  const closeAll = () => { for (const t of Object.values(translators)) t.close?.(); };
  // The resident Codex process holds the account it started with; a new one reads the new sign-in.
  codexAccount.onAccountChange = () => translators.codex?.close?.();
  const queue = new JobQueue({ translate: async (request, signal, progress) => {
    // Recheck at execution time: another queued request may have just completed this translation.
    if (request.wholeEpisode) { const cached = episodes.database.get(request); if (cached) return cached; }
    if (!translators[request.provider] && enabledProviders(config).includes(request.provider)) translators[request.provider] = await TRANSLATORS[request.provider](config);
    const translator = translators[request.provider];
    if (!translator) throw new Error(`The ${request.provider} translator is not enabled`);
    const baseUsage = request.wholeEpisode ? episodes.database.usage(request, { partial: true }) : null;
    let segments;
    try {
      segments = await translateCheckpoints(request, translator, signal, progress,
        (accepted, usage) => {
          if (request.wholeEpisode) {
            episodes.database.save(request, accepted, { usage: addUsage(baseUsage, usage) });
            return episodes.database.get(request) || episodes.database.partial(request);
          }
        });
    } catch (error) {
      // A failure may be a lost sign-in. Ask Codex; if so, stop the resident process, which
      // would keep failing, so the next attempt starts one that sees the new sign-in.
      if (request.provider === 'codex' && !signal.aborted && await codexAccount.refresh() !== 'ready') { translator.close?.(); error.needsUser = true; }
      throw error;
    }
    signal.throwIfAborted();
    return segments;
  } }, config);
  const episodes = new EpisodeManager(queue, config);
  const server = createServer(config, queue, episodes, codexAccount);
  server.requestTimeout = 15000;
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} already in use. Run doctor.` : e.message); closeAll(); process.exitCode = 1; });
  server.listen(config.port, '127.0.0.1', () => { console.log(`Smart Subtitles service: http://127.0.0.1:${config.port} (${enabledProviders(config).join(', ')}; up to ${queue.limit} videos at once)`); void appendFile(path.join(root, 'logs/service.log'), `${new Date().toISOString()} started pid=${process.pid}\n`); });
  const stop = () => { codexAccount.cancelSignIn(); server.closePicker(); for (const job of queue.jobs.values()) job.controller.abort(); closeAll(); server.close(); setTimeout(() => process.exit(0), 500).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
