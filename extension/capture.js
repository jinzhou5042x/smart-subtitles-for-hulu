(() => {
  if (location.hostname === '127.0.0.1' && location.pathname !== '/demo') return;
  const buffer = [], requested = new Set();
  const downloads = new Set(); let stopped = false;
  function stop() { stopped = true; for (const controller of downloads) controller.abort(); downloads.clear(); }
  window.addEventListener('pagehide', stop);
  const fetchOriginal = window.fetch, openOriginal = XMLHttpRequest.prototype.open;
  const requests = new WeakMap();
  let progress = { page: location.pathname, metadata: 0, found: 0, pending: 0, received: 0 };
  function report(page, changes = {}) {
    if (page !== location.pathname) return;
    if (progress.page !== page) progress = { page, metadata: 0, found: 0, pending: 0, received: 0 };
    for (const [key, amount] of Object.entries(changes)) progress[key] += amount;
    emit({ type: 'hulu-context-progress', ...progress });
  }
  const subtitleURL = url => /\.(webvtt|vtt|ttml|dfxp|srt|smi)(?:[?#]|$)/i.test(url) || /(?:caption|subtitle)[^?#]*\.xml/i.test(url);
  const subtitleType = mime => /text\/vtt|application\/(?:ttml|dfxp)\+xml/i.test(mime);
  const metadataURL = url => /(?:playback|playlist|manifest|asset)/i.test(url) && !/\.(mp4|m4s|ts|mpd|m3u8)(?:[?#]|$)/i.test(url);
  function emit(data) { if (!stopped && data.page === location.pathname) window.postMessage(data, location.origin); }
  function publish(url, text, page, language = '') {
    if (typeof text !== 'string' || text.length > 5_000_000 || page !== location.pathname) return;
    let name; try { name = new URL(url, location.href).pathname.split('/').at(-1); } catch { name = 'captions'; }
    const data = { type: 'hulu-context-captured', page, name, text, language };
    buffer.push(data); if (buffer.length > 12) buffer.shift(); emit(data);
    report(page, { received: 1 });
  }
  async function fetchSubtitle(url, page, language) {
    if (stopped) return;
    let parsed; try { parsed = new URL(url, location.href); } catch { return; }
    const localDemo = location.hostname === '127.0.0.1' && parsed.origin === location.origin;
    if (!localDemo && (parsed.protocol !== 'https:' || /^(localhost$|127\.|0\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|\[|169\.254\.)/i.test(parsed.hostname))) return;
    if (!subtitleURL(parsed.href)) return;
    const key = page + '|' + parsed.href; if (requested.has(key)) return; requested.add(key);
    report(page, { found: 1, pending: 1 });
    const controller = new AbortController(); downloads.add(controller);
    try {
      const response = await Reflect.apply(fetchOriginal, window, [parsed.href, { credentials: 'same-origin', signal: controller.signal }]);
      if (!response.ok) throw new Error('Could not read the subtitle file');
      publish(parsed.href, await response.text(), page, language);
    } catch { requested.delete(key); emit({ type: 'hulu-context-capture-error', page, error: 'The complete subtitle file cannot be read right now' }); }
    finally { downloads.delete(controller); report(page, { pending: -1 }); }
  }
  // A key counts as a language only if the browser knows it as one (so not url, src, type...).
  const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
  const languageCode = key => { try { return /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i.test(key) && !/^(id|url|src|uri)$/i.test(key) && !!languageNames.of(key.replace('_', '-')); } catch { return false; } };
  // Only inspect playback metadata already returned to Hulu, and only follow explicit subtitle URLs.
  function metadata(data, page) {
    report(page, { metadata: 1 });
    let count = 0;
    function visit(value, language = '', depth = 0) {
      if (++count > 40000 || depth > 16 || value === null) return;
      if (typeof value === 'string') { if (subtitleURL(value) && /^(https?:|\/)/i.test(value)) void fetchSubtitle(value, page, language); return; }
      if (typeof value !== 'object') return;
      const lang = typeof value.language === 'string' ? value.language : typeof value.lang === 'string' ? value.lang : typeof value.locale === 'string' ? value.locale : language;
      // Subtitle links are also listed by language code, e.g. { "en": url, "es": url }.
      for (const [key, item] of Object.entries(value)) visit(item, !Array.isArray(value) && languageCode(key) ? key : lang, depth + 1);
    }
    visit(data);
  }
  window.fetch = function (...args) {
    const page = location.pathname, result = Reflect.apply(fetchOriginal, this, args);
    result.then(response => {
      if (!response.ok || Number(response.headers.get('content-length') || 0) > 5_000_000) return;
      const mime = response.headers.get('content-type') || '';
      if (subtitleURL(response.url) || subtitleType(mime)) response.clone().text().then(text => publish(response.url, text, page)).catch(() => {});
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
