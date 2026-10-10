// The page script: connects the layers and holds no logic of its own that a layer could hold.
//   site.js + players/*   where the title is and what time it is       (SubtitleSite)
//   tracks.js             which subtitle track is the title's          (SubtitleTracks)
//   session.js            the translation of that track                (SubtitleSession)
//   overlay.js            the two lines over the picture               (SubtitleOverlay)
// Subtitle files arrive from capture.js, which runs in the page's own JavaScript world.
(() => {
  if (location.hostname === '127.0.0.1' && location.pathname !== '/demo') return;
  if (globalThis.__huluContextSubtitles) return;
  const C = globalThis.SubtitleCore, T = globalThis.SubtitleTracks, site = globalThis.SubtitleSite, version = chrome.runtime.getManifest().version;
  const send = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error === 'NOT_PAIRED' ? 'Not paired: open the extension and enter the pairing code' : r?.error || 'Connection lost; reload the page'); return r.data; };
  const session = new globalThis.SubtitleSession.TranslationSession({ send });
  const overlay = globalThis.SubtitleOverlay.createOverlay({ onMove: subtitleOffset => { settings = { ...settings, subtitleOffset }; send({ type: 'savePosition', subtitleOffset }).catch(() => {}); } });
  const parseXml = text => new DOMParser().parseFromString(text, 'application/xml');
  let settings, video, page = site.episodeKey(), lastScan = 0;
  let tracks = [], selected = null, imported = null, source = 'Waiting for the episode subtitles';
  // contentStarted: when the title itself (not an ad) first played on this page. Players load the
  // title's subtitles only then, so waiting is counted from it, never during pre-roll ads.
  let capture = {}, captureError = '', contentStarted = 0;
  const titleSeconds = track => site.titleSeconds(video, track);
  const durationLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

  // What the popup shows: one status, one line of detail, and whether Retry can help.
  function progressInfo() {
    const seconds = contentStarted ? Math.floor((Date.now() - contentStarted) / 1000) : 0, waiting = seconds >= 20;
    const cues = session.cues, episode = session.episode;
    const checked = [capture.metadata && `${capture.metadata} playback info`, capture.manifests && `${capture.manifests} stream manifests`].filter(Boolean).join(' · ');
    if (session.complete) return { status: episode?.cached ? 'Loaded from the local database' : 'Episode subtitles ready', detail: session.stopped ? `Translating again stopped (${session.stopped}); the previous subtitles are back` : site.adBreak() ? 'Ad break · subtitles return with the episode' : 'Synced to the original timing' };
    if (session.awaiting === 'key') return { status: 'Link your Google API key file', detail: 'Translation starts after the key file is linked.', retry: false };
    if (session.error) return { status: 'Translation paused', detail: session.error, retry: true };
    // Not the viewer's to fix: the session tries again by itself.
    if (session.interrupted) return { status: 'Translation interrupted, continuing by itself', detail: session.interrupted };
    if (!video) return { status: `Waiting for a ${site.name} video`, detail: '' };
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
    // Pre-roll ads: the title's subtitles are only requested once it starts.
    if (site.adBreak()) return { status: 'Waiting for the ads to finish', detail: 'Subtitles load when the episode starts' };
    if (!contentStarted && !tracks.length && !capture.pending) return { status: 'Waiting for the episode to start', detail: '' };
    if (capture.pending > 0) return { status: 'Reading subtitle files', detail: `${capture.pending} pending · ${capture.received || 0} received`, retry: waiting };
    if (tracks.length) {
      const judged = T.assess(tracks, titleSeconds);
      if (!judged.some(a => a.seconds)) return { status: site.id === 'disney' ? 'Looking for the complete English subtitles' : 'Subtitles parsed, waiting for the player timeline', detail: `${tracks.length} subtitle files so far`, retry: waiting };
      const english = judged.filter(a => a.track.detected !== 'other');
      if (!english.length) return { status: 'No English subtitles found', detail: `${tracks.length} parsed, all in other languages`, retry: true };
      return { status: 'Subtitle timing failed the completeness check', detail: `subtitles to ${durationLabel(Math.max(...english.map(a => a.track.cues.at(-1)?.end || 0)))} · video ${durationLabel(Math.max(...english.map(a => a.seconds)))}`, retry: true };
    }
    if (captureError) return { status: 'Could not read or parse the subtitles', detail: captureError, retry: true };
    if (checked) return { status: waiting ? 'No subtitle file found for this episode' : 'Looking for the episode subtitles', detail: `Checked ${checked} · ${seconds} s${waiting ? ' · turn on captions in the player, or reload the video' : ''}`, retry: waiting };
    return { status: waiting ? 'No playback information received' : 'Waiting for the episode subtitles', detail: waiting ? 'Reload the video to try again' : '', retry: waiting };
  }

  // ---- Which track ----
  function adopt(track, label) {
    if (selected?.fingerprint === track.fingerprint) return;
    selected = track; source = label; session.use(track.cues);
  }
  function acquire() {
    if (imported) { adopt(imported, 'Imported episode subtitles'); return; }
    if (selected) return;
    const best = T.choose(tracks, titleSeconds);
    if (best) { adopt(best, 'Episode subtitle file'); return; }
    // Read only. Never change the player's track.mode, caption settings or playback.
    for (const textTrack of Array.from(video.textTracks || [])) {
      if (!['subtitles', 'captions'].includes(textTrack.kind) || !textTrack.cues?.length) continue;
      const track = T.fromTextTrack(textTrack);
      if (T.choose([track], titleSeconds)) { adopt(track, 'Episode subtitle track'); return; }
    }
  }
  function newPage() {
    window.postMessage({ type: 'hulu-context-stop' }, location.origin);
    window.postMessage({ type: 'hulu-context-resume' }, location.origin);
    capture = {}; captureError = ''; contentStarted = 0;
    tracks = []; selected = null; imported = null; source = 'Waiting for the episode subtitles'; session.use([]);
  }
  const samePage = () => { if (page !== site.episodeKey()) { page = site.episodeKey(); newPage(); } };

  // ---- Drawing ----
  function render() {
    const info = progressInfo(), cues = session.cues;
    overlay.describe({ version, site: site.id, source, cues: cues.length, translated: session.lines.size, status: info.status, detail: info.detail, error: session.error, captured: tracks.length, captureError,
      complete: session.complete, episode: session.episode?.id, timeOrigin: selected?.timeOrigin || 0, files: JSON.stringify(tracks.map(t => ({ name: t.name, language: t.language, count: t.cues.length, end: t.cues.at(-1)?.end, declared: t.declared }))) });
    if (!settings?.enabled || !video || site.adBreak()) { overlay.hide(); return; }
    const videoStyle = getComputedStyle(video), bounds = video.getBoundingClientRect();
    const rect = videoStyle.objectPosition === '50% 50%' ? C.pictureRect(bounds, video.videoWidth, video.videoHeight, videoStyle.objectFit) : bounds;
    const time = site.subtitleTime(video, selected?.timeOrigin || 0), known = Number.isFinite(time);
    overlay.describe({ clockPolicy: site.clockPolicy, mediaTime: video.currentTime, subtitleTime: known ? time : '', clockOffset: known ? video.currentTime - time : '' });
    const active = (known ? C.active(cues, time) : []).filter(c => session.lines.has(c.id));
    overlay.position = settings.subtitleOffset;
    overlay.draw({ parent: site.overlayParent(), rect, fontSize: Math.max(18, Math.min(100, Number(settings.fontSize) || 60)),
      translated: [...new Set(active.map(c => session.lines.get(c.id)))].map(s => s.text).join(' '), original: active.map(c => c.text).join(' '),
      notice: cues.length && site.awaitingClock(video) ? 'Move your pointer over the video or pause once to sync subtitles' : session.redo ? `Translating again · ${session.translated.toLocaleString()} / ${cues.length.toLocaleString()}` : '' });
  }
  let loadingSettings = false, nextSettingsAttempt = 0;
  async function loadSettings() {
    if (loadingSettings || Date.now() < nextSettingsAttempt) return;
    loadingSettings = true;
    try {
      settings = await send({ type: 'settings' }); session.error = ''; tick();
      window.postMessage({ type: 'hulu-context-replay' }, location.origin);
    } catch (e) { session.error = e.message; nextSettingsAttempt = Date.now() + 2000; }
    finally { loadingSettings = false; }
  }
  function tick() {
    // The extension was reloaded or updated: this script can no longer reach it and a new one
    // takes over. Leave nothing behind that would draw stale lines beside the new overlay.
    if (!chrome.runtime?.id) { clearInterval(timer); overlay.remove(); return; }
    if (!settings) { void loadSettings(); return; }
    if (Date.now() - lastScan > 750) {
      lastScan = Date.now();
      samePage();
      const nextVideo = site.contentVideo();
      // Player elements disappear briefly during startup and ad transitions.
      // Keep this title's captures and downloads; only a route change resets them.
      if (!video && nextVideo) window.postMessage({ type: 'hulu-context-resume' }, location.origin);
      video = nextVideo; if (video && settings.enabled) acquire();
      if (video && !contentStarted && !site.adBreak() && !video.paused && video.currentTime > 0.5) contentStarted = Date.now();
    }
    render();
    if (settings.enabled && video && selected) void session.run({ session: location.origin + page, title: document.title });
  }

  // ---- What the page and its clock currently are, for a report. No subtitle text, no addresses. ----
  function snapshot() {
    const time = video ? site.subtitleTime(video, selected?.timeOrigin || 0) : NaN;
    return { version, at: new Date().toISOString(), site: site.id, watchPage: site.isWatchPage(), settings: settings && { enabled: settings.enabled, target: settings.target, provider: settings.provider },
      video: video ? { id: video.id, currentTime: video.currentTime, duration: video.duration, paused: video.paused, seeking: video.seeking, readyState: video.readyState, width: Math.round(video.getBoundingClientRect().width) } : null,
      ad: site.adBreak(), clock: { policy: site.clockPolicy, subtitleTime: Number.isFinite(time) ? time : null, awaitingViewer: video ? site.awaitingClock(video) : false, ...(video ? site.clockState(video) : {}) },
      tracks: T.describe(tracks, titleSeconds, selected), source,
      translation: { lines: session.cues.length, held: session.lines.size, complete: session.complete, working: session.working, service: session.episode?.status || null, error: session.error, interrupted: session.interrupted, attempts: session.attempts, awaiting: session.awaiting, again: !!session.redo },
      capture: { ...capture, error: captureError }, popup: progressInfo() };
  }

  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (m.type === 'settingsChanged') {
      const changed = settings?.target !== m.settings.target || settings?.provider !== m.settings.provider; settings = m.settings;
      // Another language or translator has its own record; a finished setup can try again.
      if (changed || ((session.error || session.awaiting) && m.retryProvider === settings.provider)) session.reset();
      render(); respond({ ok: true });
    } else if (m.type === 'diagnostics') {
      const info = progressInfo();
      // tone: done, working, error or waiting; the popup draws the progress from these fields.
      const tone = session.complete ? 'done' : session.error ? 'error' : session.working || session.interrupted ? 'working' : info.retry ? 'error' : 'waiting';
      respond({ version, video: !!video, source, total: session.cues.length, translated: session.translated, complete: session.complete, redo: !!session.redo, provider: settings?.provider, busy: session.busy, ...info, tone,
        cached: !!session.episode?.cached, elapsedMs: session.episode && !session.episode.cached ? session.episode.elapsedMs : null, usage: session.episode?.usage || null, error: session.error, captureError, episodeId: session.episode?.id,
        files: tracks.map(t => ({ name: t.name, language: t.language, cues: t.cues.length })) });
    } else if (m.type === 'snapshot') respond(snapshot());
    else if (m.type === 'retry') { session.retry(); captureError = ''; window.postMessage({ type: 'hulu-context-replay', retry: true }, location.origin); respond({ ok: true }); }
    else if (m.type === 'retranslate') respond(session.again() ? { ok: true } : { ok: false, error: 'Nothing to translate again yet' });
    else if (m.type === 'importSubtitles') {
      try { imported = T.parse(m.text, { name: 'imported', declared: true }, parseXml); adopt(imported, 'Imported episode subtitles'); respond({ ok: true, count: imported.cues.length }); }
      catch (e) { respond({ ok: false, error: e.message }); }
    }
  });
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin) return;
    const data = e.data;
    if (data?.type === 'hulu-context-resource-request' && data.page === location.pathname && typeof data.id === 'string' && data.id.length < 80 && site.id === 'disney' && globalThis.SubtitleSites.subtitleResource(data.url)) {
      const { id, page: requestedPage, url } = data;
      const reply = result => { if (requestedPage === location.pathname) window.postMessage({ type: 'hulu-context-resource-result', id, page: requestedPage, ...result }, location.origin); };
      send({ type: 'subtitleResource', url }).then(reply, () => reply({ error: 'Could not read the Disney+ subtitle file' }));
      return;
    }
    if (data?.page !== location.pathname) return;
    if (data.type === 'hulu-context-progress') {
      samePage();
      for (const key of ['metadata', 'manifests', 'found', 'pending', 'received']) capture[key] = Math.max(0, Math.min(40000, Number(data[key]) || 0));
    } else if (data.type === 'hulu-context-capture-error') captureError = String(data.error).slice(0, 200);
    else if (data.type === 'hulu-context-captured' && typeof data.text === 'string' && data.text.length <= 5_000_000) {
      samePage();
      const fingerprint = C.hash(data.text); if (tracks.some(t => t.fingerprint === fingerprint)) return;
      try {
        tracks.push(T.parse(data.text, data, parseXml));
        // Keep the list short without losing what the player declared: observed files go first.
        if (tracks.length > 12) tracks.splice(Math.max(0, tracks.findIndex(t => !t.declared)), 1);
        captureError = '';
      } catch (error) { captureError = error.message; }
    }
  });
  document.addEventListener('fullscreenchange', render);
  window.addEventListener('pagehide', () => session.cancel());
  void loadSettings();
  const timer = setInterval(tick, 150);
  // Mark ready only after initialization succeeds, so a failed attach can retry.
  globalThis.__huluContextSubtitles = true;
})();
