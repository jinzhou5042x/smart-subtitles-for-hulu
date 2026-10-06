(() => {
  if (location.hostname === '127.0.0.1' && location.pathname !== '/demo') return;
  const buffer = [], requested = new Set();
  const downloads = new Set(); let stopped = false;
  function stop() { stopped = true; for (const controller of downloads) controller.abort(); downloads.clear(); }
  window.addEventListener('pagehide', stop);
  const fetchOriginal = window.fetch, openOriginal = XMLHttpRequest.prototype.open;
  const requests = new WeakMap();
  const fresh = page => ({ page, metadata: 0, manifests: 0, found: 0, pending: 0, received: 0 });
  let progress = fresh(location.pathname);
  function report(page, changes = {}) {
    if (page !== location.pathname) return;
    if (progress.page !== page) progress = fresh(page);
    for (const [key, amount] of Object.entries(changes)) progress[key] += amount;
    emit({ type: 'hulu-context-progress', ...progress });
  }
  const subtitleURL = url => /\.(webvtt|vtt|ttml|dfxp|srt|smi)(?:[?#]|$)/i.test(url) || /(?:caption|subtitle)[^?#]*\.xml/i.test(url);
  const subtitleType = mime => /text\/vtt|application\/(?:ttml|dfxp)\+xml/i.test(mime);
  const metadataURL = url => /(?:playback|playlist|manifest|asset)/i.test(url) && !/\.(mp4|m4s|ts|mpd|m3u8)(?:[?#]|$)/i.test(url);
  // Stream manifests: HLS (subtitles as EXT-X-MEDIA TYPE=SUBTITLES playlists of WebVTT segments) and DASH.
  const hlsURL = url => /\.m3u8(?:[?#]|$)/i.test(url), dashURL = url => /\.mpd(?:[?#]|$)/i.test(url);
  const hlsType = mime => /mpegurl/i.test(mime), dashType = mime => /dash\+xml/i.test(mime);
  // Keys under which playback metadata lists subtitle files whose URLs do not end in a subtitle extension.
  const subtitleKey = key => /caption|subtitle|transcript|timedtext|texttrack/i.test(key);
  const otherFile = url => /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|svg|css|js|json|mp4|m4s|m4a|ts|aac|mp3)(?:[?#]|$)/i.test(url);
  function emit(data) { if (!stopped && data.page === location.pathname) window.postMessage(data, location.origin); }
  function publish(url, text, page, language = '') {
    if (typeof text !== 'string' || text.length > 5_000_000 || page !== location.pathname) return;
    let name; try { name = new URL(url, location.href).pathname.split('/').at(-1); } catch { name = 'captions'; }
    const data = { type: 'hulu-context-captured', page, name, text, language };
    buffer.push(data); if (buffer.length > 12) buffer.shift(); emit(data);
    report(page, { received: 1 });
  }
  function remote(url) {
    let parsed; try { parsed = new URL(url, location.href); } catch { return null; }
    const localDemo = location.hostname === '127.0.0.1' && parsed.origin === location.origin;
    if (!localDemo && (parsed.protocol !== 'https:' || /^(localhost$|127\.|0\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|\[|169\.254\.)/i.test(parsed.hostname))) return null;
    return parsed;
  }
  const get = (url, signal) => Reflect.apply(fetchOriginal, window, [url, { credentials: 'same-origin', signal }]);
  // `listed`: the URL was named as a subtitle file by playback metadata or a manifest.
  async function fetchSubtitle(url, page, language, listed = false) {
    if (stopped) return;
    const parsed = remote(url); if (!parsed) return;
    if (!listed && !subtitleURL(parsed.href)) return;
    const key = page + '|' + parsed.href; if (requested.has(key)) return; requested.add(key);
    report(page, { found: 1, pending: 1 });
    const controller = new AbortController(); downloads.add(controller);
    try {
      const response = await get(parsed.href, controller.signal);
      if (!response.ok) throw new Error('Could not read the subtitle file');
      const text = await response.text();
      // A listed URL may also be an HLS playlist of subtitle segments.
      if (/^#EXTM3U/.test(text)) await segments(parsed.href, text, page, language, controller.signal);
      else publish(parsed.href, text, page, language);
    } catch { requested.delete(key); emit({ type: 'hulu-context-capture-error', page, error: 'The complete subtitle file cannot be read right now' }); }
    finally { downloads.delete(controller); report(page, { pending: -1 }); }
  }
  // An HLS subtitle playlist lists WebVTT segments; they are downloaded in order and joined into one
  // WebVTT file (cues repeated across segment boundaries are kept once). Each segment's
  // X-TIMESTAMP-MAP (MPEGTS/90000 - LOCAL) is taken relative to the first segment's: the player
  // starts the video at that first offset, so a constant map (the usual case) leaves cue times as
  // written and a map that changes mid-stream (a discontinuity) shifts the later cues by the difference.
  const clock = t => t.split(':').reduce((n, part) => n * 60 + Number(part), 0);
  const stamp = t => { const ms = Math.max(0, Math.round(t * 1000)), pad = (n, w = 2) => String(n).padStart(w, '0'); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`; };
  function timestampMap(text) {
    const map = /X-TIMESTAMP-MAP=([^\n]*)/.exec(text)?.[1]; if (!map) return 0;
    return Number(/MPEGTS:(\d+)/.exec(map)?.[1] || 0) / 90000 - clock(/LOCAL:([\d:.]+)/.exec(map)?.[1] || '0');
  }
  async function segments(url, list, page, language, signal) {
    const urls = list.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => new URL(l, url).href);
    if (!urls.length || urls.length > 5000) throw new Error('Unexpected subtitle playlist');
    const texts = new Array(urls.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++, response = await get(urls[i], signal);
        if (!response.ok) throw new Error('Could not read a subtitle segment');
        texts[i] = await response.text();
      }
    }));
    const seen = new Set(), cues = [], first = timestampMap(texts[0]);
    for (const text of texts) {
      const shift = timestampMap(text) - first;
      for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
        const lines = block.split('\n'), at = lines.findIndex(l => l.includes('-->'));
        if (at < 0) continue; // WEBVTT header, X-TIMESTAMP-MAP, STYLE, REGION and NOTE blocks
        let cue = lines.slice(at).join('\n').trim();
        if (Math.abs(shift) > 0.0005) cue = cue.replace(/^([\d:.]+)(\s+-->\s+)([\d:.]+)/, (_, a, arrow, b) => stamp(clock(a) + shift) + arrow + stamp(clock(b) + shift));
        if (!seen.has(cue)) { seen.add(cue); cues.push(cue); }
      }
    }
    if (!cues.length) throw new Error('The subtitle segments are not WebVTT');
    publish(url, `WEBVTT\n\n${cues.join('\n\n')}\n`, page, language);
  }
  const attributes = line => Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
  const manifestsSeen = new Set();
  function hls(text, url, page) {
    if (!text.includes('#EXT-X-MEDIA')) return; // a media playlist, not the main one
    report(page, { manifests: 1 });
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const a = attributes(line.slice(13));
      // Forced tracks only cover foreign-language parts; they are not the episode's subtitles.
      if (a.TYPE === 'SUBTITLES' && a.URI && a.FORCED !== 'YES') void fetchSubtitle(new URL(a.URI, url).href, page, a.LANGUAGE || '', true);
    }
  }
  function dash(text, url, page) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) return;
    report(page, { manifests: 1 });
    const base = new URL(xml.getElementsByTagName('BaseURL')[0]?.parentElement?.localName === 'MPD' ? xml.getElementsByTagName('BaseURL')[0].textContent.trim() : '', url).href;
    for (const set of xml.getElementsByTagName('AdaptationSet')) {
      const mime = set.getAttribute('mimeType') || set.getElementsByTagName('Representation')[0]?.getAttribute('mimeType') || '';
      if (set.getAttribute('contentType') !== 'text' && !/text\/vtt|ttml/i.test(mime)) continue;
      const file = [...set.getElementsByTagName('BaseURL')].at(-1)?.textContent.trim();
      if (file) void fetchSubtitle(new URL(file, base).href, page, set.getAttribute('lang') || '', true);
    }
  }
  // Reads a manifest the player loads in a worker (only its URL appears in the playback metadata).
  async function manifest(url, page) {
    const parsed = remote(url); if (!parsed || manifestsSeen.has(page + '|' + parsed.href)) return;
    manifestsSeen.add(page + '|' + parsed.href);
    try { const response = await get(parsed.href); if (response.ok) inspect(parsed.href, await response.text(), page, response.headers.get('content-type') || ''); } catch { /* the player reports its own errors */ }
  }
  function inspect(url, text, page, mime) {
    if (typeof text !== 'string' || text.length > 5_000_000) return;
    try {
      if (hlsURL(url) || hlsType(mime) || /^#EXTM3U/.test(text)) hls(text, url, page);
      else if (dashURL(url) || dashType(mime)) dash(text, url, page);
    } catch { /* never interfere with playback */ }
  }
  // A key counts as a language only if the browser knows it as one (so not url, src, type...).
  const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const languageCode = key => { try { return /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i.test(key) && !/^(id|url|src|uri)$/i.test(key) && !!languageNames.of(key.replace('_', '-')); } catch { return false; } };
  // Only inspect playback metadata already returned to Hulu, and only follow explicit subtitle URLs.
  function metadata(data, page) {
    report(page, { metadata: 1 });
    let count = 0;
    function visit(value, language = '', depth = 0, key = '') {
      if (++count > 40000 || depth > 16 || value === null) return;
      if (typeof value === 'string') {
        if (!/^(https?:|\/)/i.test(value)) return;
        if (subtitleURL(value) || (subtitleKey(key) && !otherFile(value))) void fetchSubtitle(value, page, language, subtitleKey(key));
        else if (hlsURL(value) || dashURL(value)) void manifest(value, page);
        return;
      }
      if (typeof value !== 'object') return;
      const lang = typeof value.language === 'string' ? value.language : typeof value.lang === 'string' ? value.lang : typeof value.locale === 'string' ? value.locale : language;
      // Subtitle links are also listed by language code, e.g. { "en": url, "es": url }.
      // Below a subtitle key every link keeps it, e.g. { transcripts: { webvtt: { en: url } } }.
      for (const [name, item] of Object.entries(value)) visit(item, !Array.isArray(value) && languageCode(name) ? name : lang, depth + 1, Array.isArray(value) || languageCode(name) || subtitleKey(key) ? key : name);
    }
    visit(data);
  }
  window.fetch = function (...args) {
    const page = location.pathname, result = Reflect.apply(fetchOriginal, this, args);
    result.then(response => {
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 5_000_000) return;
      const mime = response.headers.get('content-type') || '';
      if (subtitleURL(response.url) || subtitleType(mime)) response.clone().text().then(text => publish(response.url, text, page)).catch(() => {});
      else if (hlsURL(response.url) || hlsType(mime) || dashURL(response.url) || dashType(mime)) response.clone().text().then(text => inspect(response.url, text, page, mime)).catch(() => {});
      else if (metadataURL(response.url) && /json/i.test(mime)) response.clone().json().then(data => metadata(data, page)).catch(() => {});
    }).catch(() => {}); return result;
  };
  XMLHttpRequest.prototype.open = function (...args) {
    requests.set(this, { url: String(args[1]), page: location.pathname });
    this.addEventListener('load', () => {
      const request = requests.get(this); if (!request || this.status < 200 || this.status >= 300) return;
      const url = this.responseURL || request.url, mime = this.getResponseHeader('content-type') || '';
      try {
        if (subtitleURL(url) || subtitleType(mime)) {
          if (!this.responseType || this.responseType === 'text') publish(url, this.responseText, request.page);
          else if (this.responseType === 'arraybuffer' && this.response.byteLength < 5_000_000) publish(url, new TextDecoder().decode(this.response), request.page);
        } else if (hlsURL(url) || hlsType(mime) || dashURL(url) || dashType(mime)) {
          if (!this.responseType || this.responseType === 'text') inspect(url, this.responseText, request.page, mime);
        } else if (metadataURL(url) && /json/i.test(mime)) {
          if (this.responseType === 'json') metadata(this.response, request.page);
          else if (!this.responseType || this.responseType === 'text') metadata(JSON.parse(this.responseText), request.page);
        }
      } catch { /* Non-subtitle payloads must never interfere with Hulu playback. */ }
    }, { once: true });
    return Reflect.apply(openOriginal, this, args);
  };
  // A <track src> can be loaded directly without touching its enabled/disabled mode.
  function scanTracks() { for (const t of document.querySelectorAll('video track[src]')) void fetchSubtitle(t.src, location.pathname, t.srclang || ''); }
  let lastReplay = 0;
  window.addEventListener('message', e => {
    if (e.source === window && e.origin === location.origin) {
      if (e.data?.type === 'hulu-context-stop') { stop(); return; }
      if (e.data?.type === 'hulu-context-resume') { stopped = false; scanTracks(); return; }
    }
    if (e.source !== window || e.origin !== location.origin || e.data?.type !== 'hulu-context-replay' || Date.now() - lastReplay < 1000) return;
    lastReplay = Date.now(); for (const data of buffer) emit(data); scanTracks(); report(location.pathname);
  });
  setInterval(scanTracks, 2000);
})();
