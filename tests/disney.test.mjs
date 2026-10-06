import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import '../extension/sites.js';
import { readSubtitleResource } from '../extension/subtitle-resource.js';

const sites = globalThis.SubtitleSites;
const profileCode = await readFile(new URL('../extension/site.js', import.meta.url), 'utf8');
const captureCode = await readFile(new URL('../extension/capture.js', import.meta.url), 'utf8');
const video = (width, extra = {}) => ({ id: '', paused: true, ended: false, readyState: 4, getBoundingClientRect: () => ({ width, height: width / 2 }), ...extra });

test('supported origins are exact HTTPS domains, not lookalikes or unrelated pages', () => {
  for (const u of ['https://disneyplus.com/play/id', 'https://www.disneyplus.com/en-us/video/id']) assert.equal(sites.identify(u), 'disney');
  assert.equal(sites.identify('https://www.hulu.com/watch/id'), 'hulu');
  assert.equal(sites.identify('http://127.0.0.1:43127/demo'), 'demo');
  for (const u of ['http://disneyplus.com/play/id', 'https://disneyplus.com.evil.test/play/id', 'https://notdisneyplus.com', 'http://127.0.0.1:43127/private']) assert.equal(sites.identify(u), null);
});

function profile(href, videos = [], elements = {}) {
  const context = vm.createContext({ SubtitleSites: sites, location: new URL(href), document: {
    body: {}, fullscreenElement: null,
    querySelector: selector => elements[selector],
    querySelectorAll: selector => selector === 'video' ? videos : elements[selector] || []
  }, getComputedStyle: element => ({ display: element.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }) });
  vm.runInContext(profileCode, context);
  return context;
}

test('Disney playback routes select the visible content video, ignore previews and support fullscreen', () => {
  const movie = video(1200), hidden = video(1600, { hidden: true }), ad = video(1800, { id: 'ad-video-player' });
  for (const route of ['/play/episode', '/video/episode', '/en-us/video/episode', '/zh-hant/play/episode']) {
    const p = profile('https://www.disneyplus.com' + route, [hidden, ad, movie], { 'video#content-video-player, video.btm-media-client-element': hidden });
    assert.equal(p.SubtitleSite.contentVideo(), movie);
    assert.equal(p.SubtitleSite.name, 'Disney+');
    p.document.fullscreenElement = {};
    assert.equal(p.SubtitleSite.overlayParent(), p.document.fullscreenElement);
    p.location.pathname = '/browse';
    assert.equal(p.SubtitleSite.contentVideo(), undefined);
  }
});

test('Hulu content clock and paused-ad detection remain intact', () => {
  const content = video(1200), ad = video(1200);
  const p = profile('https://www.hulu.com/watch/id', [ad, content], { '#content-video-player': content, '#ad-video-player': ad });
  assert.equal(p.SubtitleSite.contentVideo(), content);
  assert.equal(p.SubtitleSite.adBreak(), true);
  ad.ended = true;
  assert.equal(p.SubtitleSite.adBreak(), false);
});

test('CDN fallback rejects private/credential/media URLs and never sends cookies or follows redirects', async () => {
  let calls = 0;
  const fetcher = async (url, options) => { calls++; assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello'); };
  for (const url of ['https://127.0.0.1/a.vtt', 'https://dssott.com.evil.test/a.vtt', 'https://media.dssott.com/movie.mp4', 'https://media.dssott.com/license', 'https://user:pass@media.dssott.com/a.vtt']) await assert.rejects(readSubtitleResource(url, fetcher), /Unsupported/);
  assert.equal(calls, 0);
  assert.match((await readSubtitleResource('https://media.dssott.com/subs/a.vtt?token=test', fetcher)).text, /Hello/);
  await assert.rejects(readSubtitleResource('https://media.dssott.com/a.vtt', async () => new Response('<html>Not subtitles</html>')), /not a subtitle/);
  await assert.rejects(readSubtitleResource('https://media.dssott.com/a.vtt', async () => new Response('x'.repeat(5_000_001))), /too large/);
});

async function captureFixture({ playlist, page = '/play/example', cors = false, failSubtitleOnce = false } = {}) {
  const origin = 'https://www.disneyplus.com', master = 'https://media.dssott.com/movie/master.m3u8';
  const requests = [], messages = [], intervals = [], listeners = new Map();
  const files = {
    [master]: '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="en-US",NAME="English",URI="en/main.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="en",FORCED=YES,URI="forced.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="es",URI="es.m3u8"',
    'https://media.dssott.com/movie/en/main.m3u8': playlist || '#EXTM3U\n#EXTINF:5,\n1.vtt\n#EXTINF:5,\n2.vtt\n#EXT-X-ENDLIST',
    'https://media.dssott.com/movie/en/1.vtt': 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:03.000\nHello there.\n\n00:00:04.000 --> 00:00:06.000\nBoundary.',
    'https://media.dssott.com/movie/en/2.vtt': 'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:04.000 --> 00:00:06.000\nBoundary.\n\n00:00:07.000 --> 00:00:09.000\nGoodbye.'
  };
  class XHR { open() {} }
  const window = {
    addEventListener(type, cb) { const list = listeners.get(type) || []; list.push(cb); listeners.set(type, list); },
    postMessage(data) {
      messages.push(data);
      if (data.type === 'hulu-context-resource-request') queueMicrotask(() => {
        for (const cb of listeners.get('message') || []) cb({ source: window, origin, data: { type: 'hulu-context-resource-result', id: data.id, page: data.page, text: files[data.url], mime: 'text/vtt' } });
      });
    },
    fetch: async url => {
      requests.push(String(url));
      if (cors && /\.vtt$/.test(url)) throw new TypeError('Failed to fetch');
      if (failSubtitleOnce && String(url).endsWith('/en/main.m3u8')) { failSubtitleOnce = false; return new Response('', { status: 503 }); }
      const metadata = String(url).includes('/media/');
      const response = new Response(metadata ? JSON.stringify({ stream: { sources: [{ complete: { url: master } }] } }) : files[url], { status: metadata || files[url] ? 200 : 404, headers: { 'content-type': metadata ? 'application/json' : 'text/plain' } });
      Object.defineProperty(response, 'url', { value: String(url) }); return response;
    }
  };
  const context = vm.createContext({ window, location: new URL(origin + page), XMLHttpRequest: XHR, URL, Response, TextDecoder, AbortController, Intl, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval(fn) { intervals.push(fn); }, SubtitleSites: sites, document: { querySelectorAll: () => [] } });
  vm.runInContext(captureCode, context);
  await window.fetch('https://disney.playback.edge.bamgrid.com/media/example/scenarios/browser');
  for (let i = 0; i < 100 && !messages.some(m => m.type === 'hulu-context-captured' || m.type === 'hulu-context-capture-error'); i++) await new Promise(r => setTimeout(r, 5));
  return { requests, messages, window, context, listeners, intervals };
}

test('Disney media metadata discovers full English HLS subtitles, resolves relative segments and deduplicates boundaries', async () => {
  const { requests, messages } = await captureFixture();
  const result = messages.find(m => m.type === 'hulu-context-captured');
  assert.ok(result);
  assert.equal(result.language, 'en-US');
  assert.equal(result.duration, 10);
  assert.equal(result.timeOrigin, 10);
  assert.equal((result.text.match(/Boundary\./g) || []).length, 1);
  assert.match(result.text, /00:00:07.000 --> 00:00:09.000/);
  assert.equal(requests.some(u => /forced|es\.m3u8/.test(u)), false);
});

test('live, encrypted and media-segment playlists are never treated as complete subtitles', async () => {
  for (const playlist of ['#EXTM3U\n#EXTINF:5,\n1.vtt', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n1.vtt\n#EXT-X-ENDLIST', '#EXTM3U\n1.mp4\n#EXT-X-ENDLIST']) {
    const { messages, requests } = await captureFixture({ playlist });
    assert.ok(messages.some(m => m.type === 'hulu-context-capture-error'));
    assert.equal(messages.some(m => m.type === 'hulu-context-captured'), false);
    assert.equal(requests.some(u => /\.mp4|\/key$/.test(u)), false);
  }
});

test('page CORS failures use the extension bridge and still produce the complete episode', async () => {
  const { messages } = await captureFixture({ cors: true });
  assert.equal(messages.filter(m => m.type === 'hulu-context-resource-request').length, 2);
  const result = messages.find(m => m.type === 'hulu-context-captured');
  assert.match(result.text, /Hello there/);
  assert.match(result.text, /Goodbye/);
});

test('Disney falls back to the subtitle timestamp-map without shifting Hulu', () => {
  const hive = { currentTime: 35, classList: { contains: value => value === 'hive-video' } };
  assert.equal(profile('https://www.disneyplus.com/play/example').SubtitleSite.subtitleTime(hive, 25), 10);
  assert.equal(profile('https://www.hulu.com/watch/example').SubtitleSite.subtitleTime(hive, 25), 35);
});

test('Disney calibrates from public shadow-DOM progress and retains the offset after controls decay', () => {
  const movie = { currentTime: 38.5, paused: false, src: 'blob:episode' };
  const progress = { style: { width: '1.85%' } };
  const slider = { getAttribute: name => name === 'aria-valuenow' ? '18' : '1000', querySelector: () => progress };
  const nested = { querySelector: () => slider, querySelectorAll: () => [] };
  const root = { querySelector: () => null, querySelectorAll: () => [{ shadowRoot: nested }] };
  const elements = { 'main-app-controls-overlay': { shadowRoot: root } };
  const p = profile('https://www.disneyplus.com/play/example', [], elements);
  assert.equal(p.SubtitleSite.subtitleTime(movie), 18.5);
  delete elements['main-app-controls-overlay']; movie.currentTime = 55;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 35);
  movie.paused = true;
  elements['.text-to-speech-status'] = { textContent: 'Paused at 34750.' };
  assert.equal(p.SubtitleSite.subtitleTime(movie), 34.75);
  movie.paused = false; movie.currentTime = 65;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 44.75);
  delete elements['.text-to-speech-status'];
  p.location.pathname = '/play/next'; movie.currentTime = 10;
  assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  movie.paused = true; elements['.text-to-speech-status'] = { textContent: 'Paused at 10000.' };
  assert.equal(p.SubtitleSite.subtitleTime(movie), 10);
});

test('Hive waits for a public content clock instead of showing early subtitles', () => {
  const movie = { id: 'hivePlayer1', currentTime: 45, paused: true };
  const elements = {};
  const p = profile('https://www.disneyplus.com/play/example', [], elements);
  assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  elements['.text-to-speech-status'] = { textContent: 'Paused at 25000.' };
  assert.equal(p.SubtitleSite.subtitleTime(movie), 25);
});

test('packaged scripts and settings broadcasts share the supported site set', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  for (const script of manifest.content_scripts) {
    for (const match of sites.matches) assert.ok(script.matches.includes(match));
    assert.equal(script.js[0], 'sites.js');
  }
});


for (const host of ['www.disneyplus.com/play']) {
  test(`${host}: ad end rejects stale/ad clocks, reacquires content time and handles repeated breaks`, () => {
    let now = 100, maximum = 1000, moves = 0;
    const slider = { getAttribute: name => String(name === 'aria-valuenow' ? now : maximum) };
    const marker = video(1200);
    const elements = {
      'main-app-controls-overlay': { shadowRoot: { querySelector: () => slider, querySelectorAll: () => [] } },
      '.Timeline__slider[aria-label="Timeline"]': slider,
      '[data-ad-playing="true"], .ad-showing': []
    };
    const p = profile(`https://${host}/episode`, [], elements);
    p.MouseEvent = class { constructor(type) { this.type = type; } };
    const movie = video(1200, { currentTime: 120, paused: false, dispatchEvent: () => { moves++; } });
    assert.equal(p.SubtitleSite.subtitleTime(movie), 100);
    elements['[data-ad-playing="true"], .ad-showing'] = [marker];
    assert.equal(p.SubtitleSite.adBreak(), true);
    assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
    elements['[data-ad-playing="true"], .ad-showing'] = [];
    movie.currentTime = 150;
    assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
    assert.equal(moves, 1);
    now = 2; maximum = 30;
    assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
    now = 101; maximum = 1000;
    assert.equal(p.SubtitleSite.subtitleTime(movie), 101);
    elements['[data-ad-playing="true"], .ad-showing'] = [marker];
    p.SubtitleSite.adBreak();
    elements['[data-ad-playing="true"], .ad-showing'] = [];
    assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
    now = 102; movie.currentTime = 181;
    assert.equal(p.SubtitleSite.subtitleTime(movie), 102);
    movie.seeking = true;
    assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  });
}

test('fresh pause time wins over a stale slider after an ad', () => {
  let now = 100;
  const slider = { getAttribute: name => String(name === 'aria-valuenow' ? now : 1000) };
  const elements = {
    'main-app-controls-overlay': { shadowRoot: { querySelector: () => slider, querySelectorAll: () => [] } },
    '[data-ad-playing="true"], .ad-showing': [],
    '.text-to-speech-status': { textContent: '' }
  };
  const p = profile('https://www.disneyplus.com/play/episode', [], elements);
  const movie = video(1200, { currentTime: 120, paused: false });
  assert.equal(p.SubtitleSite.subtitleTime(movie), 100);
  elements['[data-ad-playing="true"], .ad-showing'] = [video(1200)];
  p.SubtitleSite.adBreak();
  elements['[data-ad-playing="true"], .ad-showing'] = [];
  assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  movie.paused = true; movie.currentTime = 160;
  elements['.text-to-speech-status'].textContent = 'Paused at 110500.';
  assert.equal(p.SubtitleSite.subtitleTime(movie), 110.5);
  assert.equal(p.SubtitleSite.subtitleTime(movie), 110.5);
  now = 111; movie.currentTime = 160.5;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 111);
});


test('reattaching capture reuses its hooks and replay listener', async () => {
  const { context, window, listeners } = await captureFixture();
  const wrappedFetch = window.fetch;
  const messageListeners = listeners.get('message').length;
  vm.runInContext(captureCode, context);
  assert.equal(window.fetch, wrappedFetch);
  assert.equal(listeners.get('message').length, messageListeners);
});


test('Retry fetches a failed discovered subtitle playlist without replaying playback metadata', async () => {
  const { requests, messages, window, listeners } = await captureFixture({ failSubtitleOnce: true });
  assert.ok(messages.some(m => m.type === 'hulu-context-capture-error'));
  assert.equal(messages.some(m => m.type === 'hulu-context-captured'), false);
  for (const listener of listeners.get('message')) listener({ source: window, origin: 'https://www.disneyplus.com', data: { type: 'hulu-context-replay', retry: true } });
  for (let i = 0; i < 100 && !messages.some(m => m.type === 'hulu-context-captured'); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(messages.some(m => m.type === 'hulu-context-captured'));
  assert.equal(requests.filter(u => u.endsWith('/en/main.m3u8')).length, 2);
  assert.equal(requests.filter(u => u.includes('/media/')).length, 1);
});

test('resume replays buffered subtitles after capture was stopped', async () => {
  const { messages, window, listeners } = await captureFixture();
  const count = messages.filter(m => m.type === 'hulu-context-captured').length;
  for (const type of ['hulu-context-stop', 'hulu-context-resume']) {
    for (const listener of listeners.get('message')) listener({ source: window, origin: 'https://www.disneyplus.com', data: { type } });
  }
  assert.equal(messages.filter(m => m.type === 'hulu-context-captured').length, count + 1);
});


test('failed subtitle fetch retries automatically with backoff, without a click or reload', async () => {
  const { requests, messages, context, intervals } = await captureFixture({ failSubtitleOnce: true });
  for (const tick of intervals) tick();
  assert.equal(requests.filter(u => u.endsWith('/en/main.m3u8')).length, 1);
  context.Date = { now: () => Date.now() + 3000 };
  for (const tick of intervals) tick();
  for (let i = 0; i < 100 && !messages.some(m => m.type === 'hulu-context-captured'); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(messages.some(m => m.type === 'hulu-context-captured'));
  assert.equal(requests.filter(u => u.endsWith('/en/main.m3u8')).length, 2);
});


test('a frozen visible timeline must not drag the subtitle clock backwards', () => {
  let now = 100;
  const slider = { getAttribute: name => String(name === 'aria-valuenow' ? now : 1000) };
  const elements = { 'main-app-controls-overlay': { shadowRoot: { querySelector: () => slider, querySelectorAll: () => [] } } };
  const p = profile('https://www.disneyplus.com/play/episode', [], elements);
  const movie = video(1200, { currentTime: 120, paused: false });
  assert.equal(p.SubtitleSite.subtitleTime(movie), 100);
  for (let seconds = 1; seconds <= 10; seconds++) {
    movie.currentTime = 120 + seconds;
    assert.equal(p.SubtitleSite.subtitleTime(movie), 100 + seconds);
  }
  now = 110;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 110);
});

test('stale visual bar width cannot override a fresh numeric content time', () => {
  const slider = { getAttribute: name => name === 'aria-valuenow' ? '110' : '1000', querySelector: () => ({ style: { width: '10%' } }) };
  const p = profile('https://www.disneyplus.com/play/episode', [], { 'main-app-controls-overlay': { shadowRoot: { querySelector: () => slider, querySelectorAll: () => [] } } });
  assert.equal(p.SubtitleSite.subtitleTime(video(1200, { currentTime: 130, paused: false })), 110);
});


test('Hulu dedicated content clock ignores rounded or frozen UI timing, including after ads', () => {
  const movie = video(1200, { id: 'content-video-player', currentTime: 215.949045, paused: true });
  const ad = video(1200, { ended: true });
  const slider = { getAttribute: name => name === 'aria-valuenow' ? '215' : '1915' };
  const p = profile('https://www.hulu.com/watch/example', [movie], { '#content-video-player': movie, '#ad-video-player': ad, '.Timeline__slider[aria-label="Timeline"]': slider });
  assert.equal(p.SubtitleSite.subtitleTime(movie), 215.949045);
  movie.currentTime = 220.5;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 220.5);
  ad.ended = false;
  assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  ad.ended = true;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 220.5);
});


test('Hulu never selects a large intro video while its content element is absent', () => {
  const intro = video(1800, { id: 'intro-video-player' });
  const movie = video(1200, { id: 'content-video-player' });
  const elements = {};
  const p = profile('https://www.hulu.com/watch/episode', [intro, movie], elements);
  assert.equal(p.SubtitleSite.contentVideo(), undefined);
  elements['#content-video-player'] = movie;
  assert.equal(p.SubtitleSite.contentVideo(), movie);
  movie.hidden = true;
  assert.equal(p.SubtitleSite.contentVideo(), undefined);
});

test('Hulu precise clock remains exact through playback rates, seeks, source replacement and page changes', () => {
  const slider = { getAttribute: name => name === 'aria-valuenow' ? '215' : '1915' };
  const p = profile('https://www.hulu.com/watch/episode', [], { '.Timeline__slider[aria-label="Timeline"]': slider });
  let movie = video(1200, { id: 'content-video-player', currentTime: 215.949045 });
  for (const paused of [true, false]) for (const playbackRate of [0.5, 1, 2]) {
    movie.paused = paused; movie.playbackRate = playbackRate;
    for (const time of [215.949045, 216.01, 700.125, 3.999, 0, 1895.312]) {
      movie.currentTime = time;
      assert.equal(p.SubtitleSite.subtitleTime(movie, 20), time);
    }
  }
  movie.seeking = true;
  assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  movie.seeking = false; movie.currentSrc = 'blob:replacement'; movie.currentTime = 400.75;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 400.75);
  p.location.pathname = '/watch/next';
  movie = video(1200, { id: 'content-video-player', currentTime: 1.125 });
  assert.equal(p.SubtitleSite.subtitleTime(movie), 1.125);
});

test('Disney rejects an unrecognized ad duration without modifying the content offset', () => {
  let now = 100, maximum = 1000;
  const slider = { getAttribute: name => String(name === 'aria-valuenow' ? now : maximum) };
  const p = profile('https://www.disneyplus.com/play/episode', [], { 'main-app-controls-overlay': { shadowRoot: { querySelector: () => slider, querySelectorAll: () => [] } } });
  const movie = video(1200, { currentTime: 120, paused: false });
  assert.equal(p.SubtitleSite.subtitleTime(movie), 100);
  maximum = 30; now = 2; movie.currentTime = 122;
  assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(movie)));
  maximum = 1000; now = 101; movie.currentTime = 151;
  assert.equal(p.SubtitleSite.subtitleTime(movie), 101);
});


test('Disney ignores pixel widths and rejects invalid numeric timeline values', () => {
  let current = '18', maximum = '1000';
  const slider = { getAttribute: name => name === 'aria-valuenow' ? current : maximum, querySelector: () => ({ style: { width: '1.8px' } }) };
  const elements = { 'main-app-controls-overlay': { shadowRoot: { querySelector: () => slider, querySelectorAll: () => [] } } };
  const p = profile('https://www.disneyplus.com/play/episode', [], elements);
  assert.equal(p.SubtitleSite.subtitleTime(video(1200, { id: 'hivePlayer1', currentTime: 38.5 })), 18);
  for (const values of [['', '1000'], ['18', 'Infinity'], ['NaN', '1000']]) {
    [current, maximum] = values;
    assert.ok(Number.isNaN(p.SubtitleSite.subtitleTime(video(1200, { id: 'hivePlayer2', currentTime: 38.5 }))));
  }
});
