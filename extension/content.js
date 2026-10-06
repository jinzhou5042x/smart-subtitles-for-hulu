(() => {
  if (location.hostname === '127.0.0.1' && location.pathname !== '/demo') return;
  if (globalThis.__huluContextSubtitles) return;
  globalThis.__huluContextSubtitles = true;
  const C = globalThis.SubtitleCore, site = globalThis.SubtitleSite, version = chrome.runtime.getManifest().version;
  let settings, video, epoch = crypto.randomUUID(), page = site.episodeKey();
  let candidates = [], selected = null, imported = null, cues = [], translations = new Map();
  let episode = null, cursor = 0, busy = false, complete = false, lastScan = 0, retryAt = 0;
  let source = 'Waiting for the episode subtitles', status = 'Fetching the episode subtitles', error = '', captureError = '', timingInfo = '';
  // contentStarted: when the episode itself (not an ad) first played on this page. Hulu loads the
  // episode's subtitles only then, so waiting is counted from it, never during pre-roll ads.
  let capture = {}, contentStarted = 0;
  const durationLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function videoDuration() { return C.mediaDuration(video?.duration, site.timelineSeconds()); }
  function progressInfo() {
    const seconds = contentStarted ? Math.floor((Date.now() - contentStarted) / 1000) : 0;
    const waiting = seconds >= 20;
    const checked = [capture.metadata && `${capture.metadata} playback info`, capture.manifests && `${capture.manifests} stream manifests`].filter(Boolean).join(' · ');
    if (complete) return { status: episode?.cached ? 'Loaded from the local database' : 'Episode subtitles ready', detail: site.adBreak() ? 'Ad break · subtitles return with the episode' : 'Synced to the original timing' };
    if (error) return { status: 'Translation paused', detail: error, retry: true };
    if (!video) return { status: 'Waiting for a Hulu video', detail: '' };
    if (selected) {
      if (!episode) return { status: 'Subtitles parsed, submitting for translation', detail: `${cues.length} subtitles · timing checked` };
      const p = episode.progress;
      if (episode.status === 'running' && p) {
        const idle = Math.floor((Date.now() - p.lastActivity) / 1000);
        if (settings.provider === 'local') {
          const label = { local_loading: 'Preparing the local model', local_terms: 'Local model: unifying names', local_retrying: 'Batch failed validation, retrying', local_reading: 'Local model: reading subtitles', local_receiving: 'Local model: translating', validating: 'Validating this batch' }[p.phase] || 'Local model: working';
          return { status: label, detail: [p.batch && `Batch ${p.batch} of ${p.totalBatches}`, idle >= 60 && `No output for ${idle} s`].filter(Boolean).join(' · ') };
        }
        const label = { connecting: 'Connecting to Codex', submitted: 'Codex received the request', receiving: 'Receiving the Codex translation', retrying: 'Codex problem, continuing', validating: 'Validating the full translation' }[p.phase] || 'Working';
        return { status: idle >= 60 ? 'No new output from Codex' : label, detail: idle >= 60 ? `No update for ${idle} s` : '' };
      }
      return { status: episode.status === 'done' ? 'Syncing the full translation' : episode.status === 'queued' ? 'Episode translation queued' : (settings.provider === 'local' ? 'The local model is translating the episode' : settings.provider === 'google' ? 'Google is translating the episode' : 'Codex is translating the episode'), detail: '' };
    }
    // Pre-roll ads: the episode's subtitles are only requested once the episode starts.
    if (site.adBreak()) return { status: 'Waiting for the ads to finish', detail: 'Subtitles load when the episode starts' };
    if (!contentStarted && !candidates.length && !capture.pending) return { status: 'Waiting for the episode to start', detail: '' };
    if (capture.pending > 0) return { status: 'Reading subtitle files', detail: `${capture.pending} pending · ${capture.received || 0} received`, retry: waiting };
    if (candidates.length) {
      if (!videoDuration()) return { status: 'Subtitles parsed, waiting for the player timeline', detail: `${candidates.length} subtitle files · video duration not available yet`, retry: waiting };
      const english = candidates.filter(f => f.detected !== 'other');
      if (!english.length) return { status: 'No English subtitles found', detail: `${candidates.length} parsed, all in other languages`, retry: true };
      const end = Math.max(...english.map(f => f.cues.at(-1)?.end || 0));
      return { status: 'Subtitle timing failed the completeness check', detail: `subtitles to ${durationLabel(end)} · video ${durationLabel(videoDuration())}`, retry: true };
    }
    if (captureError) return { status: 'Could not read or parse the subtitles', detail: captureError, retry: true };
    if (checked) return { status: waiting ? 'No subtitle file found for this episode' : 'Looking for the episode subtitles', detail: `Checked ${checked} · ${seconds} s${waiting ? ' · turn on captions in the player, or reload the video' : ''}`, retry: waiting };
    return { status: waiting ? 'No playback information received' : 'Waiting for the episode subtitles', detail: waiting ? 'Reload the video to try again' : '', retry: waiting };
  }
  const host = document.createElement('div'); host.id = 'hulu-context-subtitles';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  // Each line sits on its own soft, blurred backing; the translation leads and the original follows
  // smaller and lighter. Padding and corners are in em, so they scale with the chosen size.
  style.textContent = `:host{all:initial;position:fixed;z-index:2147483646;pointer-events:none;display:none}*{box-sizing:border-box}
.wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;flex-direction:column;padding:0 2% 5%;text-align:center;font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"PingFang SC","Hiragino Sans","Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased}
.line{display:flex;align-items:center;justify-content:center;text-align:center;max-width:none;width:max-content;flex-shrink:0;white-space:nowrap;unicode-bidi:plaintext;line-height:1.22;border-radius:.22em;padding:.1em .5em .14em;color:#fff;font-size:var(--subtitle-size,26px);font-weight:600;letter-spacing:.005em;background:rgba(10,12,16,.58);-webkit-backdrop-filter:blur(8px) saturate(1.2);backdrop-filter:blur(8px) saturate(1.2);box-shadow:0 .08em .5em rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.06);text-shadow:0 1px 2px rgba(0,0,0,.6);transition:box-shadow .15s}
.original{font-size:var(--original-size,18px);color:rgba(255,255,255,.88);margin-top:calc(var(--original-size,18px)*.3);font-weight:450;background:rgba(10,12,16,.42)}
.line:empty{display:none}.line{pointer-events:auto;cursor:grab;user-select:none;touch-action:none}
.dragging .line{cursor:grabbing;box-shadow:0 .08em .5em rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.06),0 0 0 2px rgba(47,194,125,.65)}
.badge{position:absolute;top:16px;left:16px;color:#fff;background:#101820b5;padding:6px 10px;border-radius:6px;font:12px system-ui}.badge:empty{display:none}`;
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  // dir=auto with unicode-bidi:plaintext lays out right-to-left translations (Arabic, Hebrew, Persian) correctly.
  const translatedLine = document.createElement('div'); translatedLine.className = 'line'; translatedLine.dir = 'auto';
  const originalLine = document.createElement('div'); originalLine.className = 'line original'; originalLine.dir = 'ltr';
  const badge = document.createElement('div'); badge.className = 'badge';
  // The subtitle lines can be dragged vertically. The position is stored as a fraction of the
  // picture height, so it follows resizing and full screen. Events on the lines never reach the
  // player, so dragging does not pause or toggle full screen; the rest of the overlay stays click-through.
  let drag = null, pictureHeight = 1;
  const offset = () => drag ? drag.offset : Math.max(0, Math.min(0.85, Number(settings?.subtitleOffset) || 0));
  for (const line of [translatedLine, originalLine]) {
    line.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      drag = { y: e.clientY, from: offset(), offset: offset() }; wrap.classList.add('dragging'); line.setPointerCapture(e.pointerId);
    });
    line.addEventListener('pointermove', e => {
      if (!drag) return;
      e.preventDefault(); e.stopPropagation();
      drag.offset = Math.max(0, Math.min(0.85, drag.from + (drag.y - e.clientY) / pictureHeight)); render();
    });
    const end = e => {
      if (!drag) return;
      e.stopPropagation();
      const subtitleOffset = drag.offset; drag = null; wrap.classList.remove('dragging');
      settings = { ...settings, subtitleOffset }; render();
      send({ type: 'savePosition', subtitleOffset }).catch(() => {});
    };
    line.addEventListener('pointerup', end); line.addEventListener('pointercancel', end);
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu']) line.addEventListener(type, e => e.stopPropagation());
  }
  const fitted = new WeakMap();
  function fitLine(element, text, size, width) {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    const available = Math.max(1, Math.floor(width * 0.96));
    const key = JSON.stringify([singleLine, size, available]);
    if (fitted.get(element) === key) return;
    element.replaceChildren();
    element.style.transform = '';
    element.style.fontSize = `${size}px`;
    if (singleLine) {
      const ending = singleLine.match(/[\p{P}]+$/u)?.[0] || '';
      const body = singleLine.slice(0, singleLine.length - ending.length);
      const punctuation = document.createElement('span');
      // Keep punctuation visible, but align the text before it to the video center.
      element.append(document.createTextNode(body || singleLine));
      if (body && ending) { punctuation.textContent = ending; element.append(punctuation); }
      const natural = element.getBoundingClientRect().width;
      const tail = punctuation.getBoundingClientRect().width;
      if (natural + tail > available) element.style.fontSize = `${Math.max(1, Math.floor(size * Math.max(1, available - 20) / Math.max(1, natural + tail - 20) * 100) / 100)}px`;
      element.style.transform = `translateX(${punctuation.getBoundingClientRect().width / 2}px)`;
    }
    fitted.set(element, key);
  }
  wrap.append(translatedLine, originalLine); shadow.append(style, wrap, badge);
  const send = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error === 'NOT_PAIRED' ? 'Not paired: open the extension and enter the pairing code' : r?.error || 'Connection lost; reload the page'); return r.data; };
  const cancel = () => { const old = epoch; epoch = crypto.randomUUID(); busy = false; send({ type: 'cancel', epoch: old }).catch(() => {}); };
  function clearTranslation() { cancel(); translations.clear(); complete = false; episode = null; cursor = 0; retryAt = 0; error = ''; }
  function newPage() {
    window.postMessage({ type: 'hulu-context-stop' }, location.origin);
    window.postMessage({ type: 'hulu-context-resume' }, location.origin);
    capture = {}; contentStarted = 0;
    clearTranslation(); selected = null; imported = null; cues = []; candidates = []; captureError = ''; timingInfo = ''; source = 'Waiting for the episode subtitles'; status = 'Fetching the episode subtitles';
  }
  function entireFile(file) {
    const duration = videoDuration();
    if (!video || !duration) return false;
    return file.cues.length > 0 && file.cues.at(-1).end >= duration * 0.65 && file.cues.at(-1).end <= duration + 30;
  }
  function adopt(file, label) {
    if (selected?.fingerprint === file.fingerprint) return;
    clearTranslation(); selected = file; cues = file.cues; source = label; status = `Episode subtitles found · ${cues.length} subtitles`;
  }
  function acquire() {
    if (imported) { adopt(imported, 'Imported episode subtitles'); return; }
    if (selected) return;
    // The source is English. Each file is judged by its text (labels are often missing or wrong):
    // only files clearly in another language are skipped; undecided ones are treated as English.
    // Preference: detected English, then labeled English, then most subtitles (usually SDH).
    const labeledEnglish = f => /^en(?:[-_]|$)/i.test(f.language || '');
    const rank = f => [Number(f.detected === 'en'), Number(labeledEnglish(f)), f.cues.length];
    const matching = candidates.filter(f => entireFile(f) && f.detected !== 'other');
    const best = [...matching].sort((a, b) => { const x = rank(a), y = rank(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0];
    if (best) { adopt(best, 'Episode subtitle file'); return; }
    // Read only. Never change Hulu's track.mode, caption settings or playback.
    for (const t of Array.from(video.textTracks || [])) {
      if (!['subtitles', 'captions'].includes(t.kind) || !t.cues?.length) continue;
      const list = [...t.cues].map(c => C.cue(c.startTime, c.endTime, c.text || '')).filter(c => c.text && c.end > c.start && c.end - c.start <= 120).sort((a, b) => a.start - b.start);
      if (entireFile({ cues: list }) && C.sourceLanguage(list) !== 'other') { adopt({ cues: list, fingerprint: C.hash(JSON.stringify(list)), language: t.language }, 'Episode subtitle track'); return; }
    }
    status = captureError ? 'Could not parse the subtitle file; please retry' : candidates.length ? 'Subtitles received, checking the full timeline' : 'Fetching the episode subtitles';
  }
  function applyProgress(result) {
    episode = result;
    for (const segment of result.segments || []) for (const id of segment.sourceIds) translations.set(id, segment);
    cursor = result.cursor;
    complete = result.status === 'done' && cursor === result.segmentCount && translations.size === cues.length;
    status = complete ? `Episode subtitles ready · ${cues.length} subtitles` : `Translating episode ${result.completedCues} / ${result.totalCues}`;
  }
  async function prepareEpisode() {
    if (!settings?.enabled || !video || !selected || busy || complete || Date.now() < retryAt) return;
    const currentEpoch = epoch;
    busy = true;
    try {
      const first = await send({ type: 'prepareEpisode', request: { session: location.origin + page, epoch: currentEpoch, title: document.title, cues, context: [] } });
      if (currentEpoch !== epoch) return;
      applyProgress(first); error = '';
      while (!complete) {
        if (['error', 'cancelled'].includes(episode.status)) throw new Error(episode.error || 'Episode translation cancelled');
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (currentEpoch !== epoch) return;
        let result = await send({ type: 'episodeProgress', id: episode.id, after: cursor });
        if (currentEpoch !== epoch) return;
        if (result.status === 'done' && episode.status !== 'done' && cursor > 0) {
          result = await send({ type: 'episodeProgress', id: episode.id, after: 0 });
          if (currentEpoch !== epoch) return;
          translations.clear();
        }
        applyProgress(result);
      }
    } catch (e) { if (currentEpoch === epoch) { error = e.message; retryAt = Infinity; } }
    finally { if (currentEpoch === epoch) busy = false; }
  }
  function render() {
    const fontSize = Math.max(18, Math.min(100, Number(settings?.fontSize) || 60));
    host.style.setProperty('--subtitle-size', `${fontSize}px`);
    host.style.setProperty('--original-size', `${Math.round(fontSize * 0.7)}px`);
    host.dataset.version = version; host.dataset.source = source; host.dataset.cues = String(cues.length); host.dataset.translated = String(translations.size);
    const progress = progressInfo(); status = progress.status; host.dataset.detail = progress.detail;
    host.dataset.status = status; host.dataset.error = error; host.dataset.captured = String(candidates.length); host.dataset.captureError = captureError; host.dataset.timingInfo = timingInfo;
    host.dataset.complete = String(complete); host.dataset.episode = episode?.id || '';
    host.dataset.files = JSON.stringify(candidates.map(f => ({ name: f.name, language: f.language, count: f.cues.length, end: f.cues.at(-1)?.end })));
    if (!settings?.enabled || !video || site.adBreak()) { host.style.display = 'none'; return; }
    const parent = site.overlayParent(); if (parent && host.parentNode !== parent) parent.append(host);
    const videoStyle = getComputedStyle(video);
    const bounds = video.getBoundingClientRect();
    const rect = videoStyle.objectPosition === '50% 50%' ? C.pictureRect(bounds, video.videoWidth, video.videoHeight, videoStyle.objectFit) : bounds;
    pictureHeight = Math.max(1, rect.height);
    wrap.style.paddingBottom = `${Math.max(12, rect.height * 0.035) + offset() * rect.height}px`;
    Object.assign(host.style, { display: 'block', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    const active = C.active(cues, video.currentTime).filter(c => translations.has(c.id));
    fitLine(translatedLine, [...new Set(active.map(c => translations.get(c.id)).filter(Boolean))].map(s => s.text).join(' '), fontSize, rect.width);
    fitLine(originalLine, active.map(c => c.text).join(' '), Math.round(fontSize * 0.7), rect.width);
    badge.textContent = '';
  }
  function tick() {
    if (!settings) return;
    if (Date.now() - lastScan > 750) {
      lastScan = Date.now();
      if (page !== site.episodeKey()) { page = site.episodeKey(); newPage(); }
      const nextVideo = site.contentVideo();
      if (video && !nextVideo) { newPage(); window.postMessage({ type: 'hulu-context-stop' }, location.origin); }
      if (!video && nextVideo) window.postMessage({ type: 'hulu-context-resume' }, location.origin);
      video = nextVideo; if (video && settings.enabled) acquire();
      if (video && !contentStarted && !site.adBreak() && !video.paused && video.currentTime > 0.5) contentStarted = Date.now();
    }
    render(); void prepareEpisode();
  }
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (m.type === 'settingsChanged') {
      const languageChanged = settings?.target !== m.settings.target || settings?.provider !== m.settings.provider; settings = m.settings;
      if (languageChanged) clearTranslation();
      render(); respond({ ok: true });
    } else if (m.type === 'diagnostics') {
      const info = progressInfo(), working = !!episode && ['queued', 'running'].includes(episode.status);
      // tone: done, working, error or waiting; the popup draws the progress, time and tokens from these fields.
      const tone = complete ? 'done' : error ? 'error' : working ? 'working' : info.retry ? 'error' : 'waiting';
      respond({ version, video: !!video, source, total: cues.length, translated: translations.size, complete, busy, ...info, tone, cached: !!episode?.cached, elapsedMs: episode && !episode.cached ? episode.elapsedMs : null, usage: episode?.usage || null, error, captureError, episodeId: episode?.id, files: candidates.map(f => ({ name: f.name, language: f.language, cues: f.cues.length })) });
    } else if (m.type === 'retry') { error = ''; retryAt = 0; window.postMessage({ type: 'hulu-context-replay' }, location.origin); respond({ ok: true }); }
    else if (m.type === 'importSubtitles') {
      try { const list = C.parseSubtitles(m.text); imported = { cues: list, fingerprint: C.hash(m.text) }; adopt(imported, 'Imported episode subtitles'); respond({ ok: true, count: list.length }); }
      catch (e) { respond({ ok: false, error: e.message }); }
    }
  });
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin) return;
    if (e.data?.type === 'hulu-context-progress' && e.data.page === location.pathname) {
      if (page !== site.episodeKey()) { page = site.episodeKey(); newPage(); }
      for (const key of ['metadata', 'manifests', 'found', 'pending', 'received']) capture[key] = Math.max(0, Math.min(40000, Number(e.data[key]) || 0));
      return;
    }
    if (e.data?.type === 'hulu-context-capture-error' && e.data.page === location.pathname) { captureError = String(e.data.error).slice(0, 200); return; }
    if (e.data?.type !== 'hulu-context-captured' || e.data.page !== location.pathname || typeof e.data.text !== 'string' || e.data.text.length > 5_000_000) return;
    if (page !== site.episodeKey()) { page = site.episodeKey(); newPage(); }
    const fingerprint = C.hash(e.data.text); if (candidates.some(f => f.fingerprint === fingerprint)) return;
    try {
      let parsed, language = String(e.data.language || '').slice(0, 40);
      if (/^english$/i.test(language)) language = 'en';
      if (/^\s*(<\?xml|<(?:\w+:)?tt[\s>])/i.test(e.data.text)) {
        const xml = new DOMParser().parseFromString(e.data.text, 'application/xml');
        if (xml.querySelector('parsererror')) throw new Error('Invalid TTML');
        language ||= xml.documentElement.getAttribute('xml:lang') || '';
        const p = xml.getElementsByTagNameNS('*', 'p')[0];
        const summary = n => n ? { tag: n.localName, attrs: [...n.attributes].filter(a => /begin|end|dur|frameRate|tickRate/.test(a.localName)).map(a => [a.name, a.value]) } : null;
        timingInfo = JSON.stringify({ root: summary(xml.documentElement), p: summary(p), parent: summary(p?.parentElement), children: p ? [...p.children].slice(0, 4).map(summary) : [] });
        parsed = globalThis.SubtitleTTML.parseTTML(xml);
      } else parsed = C.parseSubtitles(e.data.text);
      if (parsed.length > 20000) throw new Error('Too many subtitle entries');
      candidates.push({ name: String(e.data.name).slice(0, 150), language, detected: C.sourceLanguage(parsed), fingerprint, cues: parsed }); if (candidates.length > 10) candidates.shift();
      captureError = '';
    } catch (e) { captureError = e.message; }
  });
  document.addEventListener('fullscreenchange', render);
  window.addEventListener('pagehide', cancel);
  send({ type: 'settings' }).then(s => { settings = s; tick(); window.postMessage({ type: 'hulu-context-replay' }, location.origin); }).catch(e => { error = e.message; });
  setInterval(tick, 150);
})();
