// Runs the page scripts in a real Chrome against the local test clip, with the extension's
// background and the translation service replaced by stand-ins: subtitle discovery, track
// choice, the translation session and the overlay's clock, end to end, in a browser.
//   node scripts/browser-check.mjs        (set CHROME_PATH if Chrome is not in its usual place)
// Not part of `npm test`: it needs Chrome. It does not check any streaming service's player.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from '../service/config.mjs';
import { PAGE_SCRIPTS } from '../extension/popup-player.js';

const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const pageWorld = manifest.content_scripts.find(s => s.world === 'MAIN').js;
// Stand-ins: the background answers settings and "translates" by prefixing each line.
const stub = `globalThis.chrome = { runtime: { id: 'check', getManifest: () => ({ version: 'check' }), onMessage: { addListener() {} },
  sendMessage: async m => ({ ok: true, data: m.type === 'settings' ? { enabled: true, target: 'zh-CN', provider: 'codex', fontSize: 60, subtitleOffset: 0 }
    : m.type === 'prepareEpisode' ? { id: 'e'.repeat(64), status: 'done', cached: false, segments: m.request.cues.map(c => ({ sourceIds: [c.id], text: '译 ' + c.text })), cursor: m.request.cues.length, segmentCount: m.request.cues.length, completedCues: m.request.cues.length, totalCues: m.request.cues.length } : {} }) } };`;
const page = `<!doctype html><meta charset="utf-8"><title>check</title>
<video id="demo-video" muted preload="auto" src="/demo.mp4" style="width:960px;height:540px"><track kind="subtitles" srclang="en" src="/demo.vtt" default></video>
<script>${stub}</script>
${[...pageWorld, ...PAGE_SCRIPTS.filter(f => !pageWorld.includes(f))].map(f => `<script src="/extension/${f}"></script>`).join('\n')}
<script>const v = document.querySelector('video'); v.addEventListener('loadedmetadata', () => { v.currentTime = 5; });</script>`;
const files = { '/demo.vtt': ['tests/fixtures/demo.vtt', 'text/vtt; charset=utf-8'], '/demo.mp4': ['tests/fixtures/demo.mp4', 'video/mp4'], '/languages.js': ['shared/languages.js', 'text/javascript'] };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/demo') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
  const [file, type] = files[url.pathname] || (url.pathname.startsWith('/extension/') && !url.pathname.includes('..') ? [url.pathname.slice(1), 'text/javascript'] : []);
  if (!file) { res.writeHead(404); return res.end(); }
  try {
    const body = await readFile(path.join(root, file)), range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) { res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Accept-Ranges': 'bytes' }); return res.end(body); }
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }); res.end(body.subarray(start, end + 1));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const dom = await new Promise((resolve, reject) => execFile(chrome, ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--virtual-time-budget=9000', '--dump-dom', `http://127.0.0.1:${server.address().port}/demo`], { maxBuffer: 1e7, timeout: 60000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const hosts = [...dom.matchAll(/<div id="hulu-context-subtitles"([^>]*)>/g)];
  assert.equal(hosts.length, 1, 'exactly one overlay');
  const data = Object.fromEntries([...hosts[0][1].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(m => [m[1].replace(/-(.)/g, (_, c) => c.toUpperCase()), m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&')]));
  const report = { site: data.site, clockPolicy: data.clockPolicy, source: data.source, lines: Number(data.cues), translated: Number(data.translated), complete: data.complete, status: data.status, mediaTime: Number(data.mediaTime), subtitleTime: Number(data.subtitleTime), files: JSON.parse(data.files || '[]') };
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.site, 'demo'); assert.equal(report.clockPolicy, 'media-v1');
  assert.ok(report.lines > 5, 'the clip\'s subtitles were found and chosen'); assert.equal(report.translated, report.lines); assert.equal(report.complete, 'true');
  assert.ok(report.files.some(f => f.declared), 'the <track> counts as declared by the page');
  assert.ok(report.mediaTime > 0, 'the video was seeked'); assert.ok(Math.abs(report.subtitleTime - report.mediaTime) < 1e-6, 'an ordinary video\'s clock is its own time');
  assert.ok(/display: block/.test(hosts[0][1]), 'the overlay is shown over the picture');
  console.log('Browser check passed.');
} finally { server.close(); server.closeAllConnections?.(); }
