// Player profiles. Routing is deliberately limited to playback pages, not preview carousels.
// capture.js (subtitle discovery) is separate because it runs in the page's own JavaScript world.
(function (scope) {
  const demo = () => location.hostname === '127.0.0.1';
  const disney = () => globalThis.SubtitleSites.identify(location.href) === 'disney';
  const clocks = new WeakMap();
  let adState = { page: '', active: false, generation: 0, maximum: null };
  function deepFind(root, selector) {
    if (!root) return null;
    const found = root.querySelector(selector); if (found) return found;
    for (const element of root.querySelectorAll('*')) {
      const nested = element.shadowRoot && deepFind(element.shadowRoot, selector);
      if (nested) return nested;
    }
    return null;
  }
  function clockSample() {
    const slider = disney()
      ? deepFind(document.querySelector('main-app-controls-overlay')?.shadowRoot, '[data-qa="progress-bar.seekableRange"]')
      : document.querySelector('.Timeline__slider[aria-label="Timeline"]');
    if (!slider) return null;
    const rawNow = slider.getAttribute('aria-valuenow'), rawMax = slider.getAttribute('aria-valuemax');
    if (rawNow == null || rawMax == null || !rawNow.trim() || !rawMax.trim()) return null;
    const now = Number(rawNow), maximum = Number(rawMax);
    const width = slider.querySelector?.('[data-qa="progress-bar.progress"]')?.style.width;
    const percent = typeof width === 'string' && /^\d+(?:\.\d+)?%$/.test(width.trim()) ? parseFloat(width) : NaN;
    if (!Number.isFinite(now) || !Number.isFinite(maximum) || !(maximum > 0) || now < 0 || now > maximum) return null;
    const visualTime = percent * maximum / 100;
    // CSS width can freeze or animate independently of the accessible timestamp.
    const content = Number.isFinite(percent) && percent >= 0 && percent <= 100 && Math.abs(visualTime - now) <= 1.5 ? visualTime : now;
    return { now, maximum, content, signature: `${rawNow}|${rawMax}|${width || ''}` };
  }
  const pauseText = () => disney() ? document.querySelector('.text-to-speech-status')?.textContent || '' : '';
  function detectAd() {
    if ([...document.querySelectorAll('[data-ad-playing="true"], .ad-showing')].some(shown)) return true;
    const ad = document.querySelector('#ad-video-player');
    return !!ad && !ad.ended && ad.readyState >= 2 && (!ad.paused || shown(ad));
  }
  function observeAd() {
    if (adState.page !== location.pathname) adState = { page: location.pathname, active: false, generation: 0, maximum: null };
    const active = detectAd();
    if (active || active !== adState.active) {
      // Controls can still contain ad/pre-ad values when the ad flag disappears.
      adState.blockedSample = clockSample()?.signature;
      adState.blockedPause = pauseText();
    }
    if (active !== adState.active) adState.generation++;
    adState.active = active;
    return active;
  }
  function revealControls(video, clock) {
    const now = Date.now();
    if (clock.attempts >= 4 || now < (clock.nextAttempt || 0)) return;
    clock.attempts++; clock.nextAttempt = now + 1000;
    if (typeof MouseEvent !== 'function' || !video.dispatchEvent) return;
    const rect = video.getBoundingClientRect();
    video.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  }
  function contentTime(video, origin) {
    const activeAd = observeAd();
    // Hulu's dedicated content element already carries subtitle time. Its integer
    // UI timeline is less precise and must never introduce a synthetic offset.
    if (!disney()) return activeAd || video.seeking || !Number.isFinite(video.currentTime) ? NaN : video.currentTime;
    const key = location.pathname + '|' + (video.currentSrc || video.src || '');
    let clock = clocks.get(video);
    if (!clock || clock.key !== key) {
      const replacedSource = !!clock;
      clock = { key, offset: disney() ? origin : 0, calibrated: false, pausedText: '', generation: adState.generation, waiting: adState.generation > 0, attempts: 0 };
      if (replacedSource) { clock.waiting = true; clock.ignoredSample = clockSample()?.signature; }
      clocks.set(video, clock);
    }
    if (clock.generation !== adState.generation) {
      clock.generation = adState.generation; clock.waiting = true;
      clock.calibrated = false; clock.attempts = 0; clock.nextAttempt = 0;
    }
    if (activeAd) return NaN;
    if (clock.waiting) revealControls(video, clock);
    if (video.seeking) return NaN;
    const text = pauseText(), paused = /^Paused at (\d+)\.$/.exec(text);
    let pauseAccepted = false;
    if (video.paused && paused && text !== clock.pausedText && (!clock.waiting || text !== adState.blockedPause)) {
      clock.offset = video.currentTime - Number(paused[1]) / 1000;
      clock.calibrated = true; clock.waiting = false; clock.pausedText = text; pauseAccepted = true;
      // Ignore the old slider until it advances after this precise pause sample.
      clock.ignoredSample = clockSample()?.signature;
    }
    const sample = clockSample();
    // A different duration may be an unrecognized ad timeline. Never adopt it.
    if (sample && adState.maximum && Math.abs(sample.maximum - adState.maximum) > 2) {
      clock.waiting = true; clock.calibrated = false; return NaN;
    }
    const fresh = sample && sample.signature !== clock.lastSample && !pauseAccepted && sample.signature !== clock.ignoredSample && (!clock.waiting || (sample.signature !== adState.blockedSample &&
      (!adState.maximum || Math.abs(sample.maximum - adState.maximum) <= 2)));
    if (fresh) { adState.maximum = sample.maximum; clock.lastSample = sample.signature; }
    if (fresh && (!clock.calibrated || Math.abs(video.currentTime - clock.offset - sample.content) > 1.5)) {
      clock.offset = video.currentTime - sample.content; clock.calibrated = true; clock.waiting = false;
      adState.maximum = sample.maximum;
    }
    if (clock.waiting || (disney() && /^hivePlayer/.test(video.id || '') && !clock.calibrated)) return NaN;
    return video.currentTime - clock.offset;
  }
  const shown = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  };
  scope.SubtitleSite = {
    get name() { return disney() ? 'Disney+' : 'Hulu'; },
    get clockPolicy() { return disney() ? 'disney-controls-v2' : 'hulu-media-v1'; },
    // Episodes play on /watch/<id>. Autoplay of the next episode moves to a new path, so the path
    // identifies the episode whose subtitles are on screen.
    isWatchPage: () => demo() || (disney() ? /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?(?:play|video)\/[^/]+\/?$/i.test(location.pathname) : location.pathname.startsWith('/watch/')),
    episodeKey: () => location.pathname,
    // The episode's own player. Ads play in a separate element, so the episode's currentTime is
    // the subtitles' time even around ad breaks.
    contentVideo() {
      if (!scope.SubtitleSite.isWatchPage()) return undefined;
      if (!disney()) {
        const content = document.querySelector('#content-video-player');
        if (content) return shown(content) ? content : undefined;
        // During Hulu player replacement, do not mistake the intro/ad video for content.
        if (!demo()) return undefined;
      }
      return [...document.querySelectorAll('video')].filter(v => v.id !== 'ad-video-player' && shown(v) && v.getBoundingClientRect().width > 200).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    },
    // A pre-roll or mid-roll ad break. The episode stands still meanwhile and its subtitles stay
    // hidden; a paused ad that is still on screen counts too, so subtitles never cover an ad.
    adBreak: observeAd,
    // The player's timeline length in seconds; some titles report video.duration as Infinity.
    timelineSeconds: () => disney() ? null : document.querySelector('.Timeline__slider[aria-label="Timeline"]')?.getAttribute('aria-valuemax'),
    subtitleTime: (video, origin = 0) => contentTime(video, origin),
    // Where the overlay lives so it stays visible in full screen.
    overlayParent: () => document.fullscreenElement || document.body,
  };
})(globalThis);
