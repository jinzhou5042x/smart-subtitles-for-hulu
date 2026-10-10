import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import '../extension/sites.js';
import '../extension/core.js';
import { PAGE_SCRIPTS } from '../extension/popup-player.js';
const read = file => readFile(new URL('../extension/' + file, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('manifest.json'));
const adapterFiles = (await readdir(new URL('../extension/players', import.meta.url))).filter(f => f.endsWith('.js')).map(f => 'players/' + f);
const CONTRACT = ['isWatchPage', 'episodeKey', 'contentVideo', 'overlayParent', 'adBreak', 'timelineSeconds', 'titleSeconds', 'subtitleTime', 'awaitingClock', 'clockState'];
const pages = { hulu: 'https://www.hulu.com/watch/abc', disney: 'https://www.disneyplus.com/play/abc', demo: 'http://127.0.0.1:43127/demo' };

test('every player adapter is loaded, in one order, wherever the page scripts are listed', () => {
  const isolated = manifest.content_scripts.find(s => s.world !== 'MAIN').js;
  assert.deepEqual(isolated, PAGE_SCRIPTS, 'the manifest and the popup\'s re-injection list are the same');
  for (const file of adapterFiles) assert.ok(isolated.includes(file), `${file} is listed`);
  assert.ok(isolated.indexOf('site.js') < Math.min(...adapterFiles.map(f => isolated.indexOf(f))), 'the contract loads before its adapters');
  assert.ok(isolated.indexOf('content.js') === isolated.length - 1);
});

test('every supported service has an adapter that answers the whole contract on its playback page', async () => {
  const code = (await Promise.all(['site.js', ...adapterFiles].map(read))).join('\n');
  const seen = new Set();
  for (const [id, href] of Object.entries(pages)) {
    assert.equal(globalThis.SubtitleSites.identify(href), id);
    const context = vm.createContext({ SubtitleSites: globalThis.SubtitleSites, SubtitleCore: globalThis.SubtitleCore, location: new URL(href), Date,
      document: { body: {}, fullscreenElement: null, querySelector: () => null, querySelectorAll: () => [] }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) });
    vm.runInContext(code, context);
    const site = context.SubtitleSite; seen.add(site.id);
    assert.equal(site.id, id); assert.equal(typeof site.name, 'string'); assert.match(site.clockPolicy, /^[a-z0-9-]+-v\d+$/);
    for (const method of CONTRACT) assert.equal(typeof site[method], 'function', `${id}.${method}`);
    const video = { id: 'v', currentTime: 12.5, duration: 600, paused: false, seeking: false, getBoundingClientRect: () => ({ width: 800, height: 450 }) };
    assert.equal(site.isWatchPage(), true); assert.equal(site.episodeKey(), new URL(href).pathname); assert.equal(site.adBreak(), false);
    assert.equal(site.contentVideo(), undefined, 'no video on an empty page');
    const time = site.subtitleTime(video, 0); assert.ok(Number.isNaN(time) || typeof time === 'number');
    assert.equal(typeof site.awaitingClock(video), 'boolean'); assert.equal(typeof site.clockState(video), 'object');
    assert.ok(site.titleSeconds(video, { duration: 600, cues: [] }) >= 0);
    video.seeking = true; assert.ok(Number.isNaN(site.subtitleTime(video, 0)), `${id} shows nothing during a seek`);
  }
  // Every service named to users is one the code can play, and has its host in the manifest.
  for (const id of ['hulu', 'disney']) assert.ok(seen.has(id));
  assert.equal(globalThis.SubtitleSites.names.length, seen.size - 1);
  const hosts = manifest.content_scripts.flatMap(s => s.matches).join(' ');
  for (const pattern of globalThis.SubtitleSites.matches) assert.ok(hosts.includes(pattern), pattern);
});
