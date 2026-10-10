// The player layer: one contract, one adapter per streaming service.
//
// Everything above this layer (subtitle tracks, translation, overlay, popup) asks the same
// questions of every service and never looks at a service's page itself:
//
//   id, name            the service, as in sites.js
//   isWatchPage()       is this a playback page (not a preview or browse page)
//   episodeKey()        identifies the title on screen; changes when another one starts
//   contentVideo()      the title's own <video>, or undefined while there is none
//   overlayParent()     where the overlay must live to stay visible (full screen)
//   adBreak()           is an ad on screen now
//   titleSeconds(video, track)   the title's length, to judge whether a track covers it; 0 if unknown
//   timelineSeconds()   the player's own timeline length, or null
//   subtitleTime(video, origin)  seconds on the subtitle track's timeline, or NaN: show nothing
//   awaitingClock(video)         only the viewer can help the clock now (show the prompt)
//   clockPolicy, clockState(video)   which clock this is and what it currently believes
//
// An adapter is a plain object passed to SubtitlePlayers.register; whatever it leaves out comes
// from `html5`, the behaviour of an ordinary page with one <video> whose currentTime is the
// title's time. A new service is one file in players/ plus its entry in sites.js and the manifest.
// What an adapter believes about its player must come from a measurement, with its date beside it.
//
// Everything here lives in the page and is rebuilt from nothing on a reload: no clock, offset
// or sample is stored anywhere.
(function (scope) {
  const shown = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  };
  function deepFind(root, selector) {
    if (!root) return null;
    const found = root.querySelector(selector); if (found) return found;
    for (const element of root.querySelectorAll('*')) {
      const nested = element.shadowRoot && deepFind(element.shadowRoot, selector);
      if (nested) return nested;
    }
    return null;
  }
  const largestVideo = () => [...document.querySelectorAll('video')].filter(v => v.id !== 'ad-video-player' && shown(v) && v.getBoundingClientRect().width > 200).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];

  // Ad breaks, per page. `generation` counts every start and end of a break. `leftover` is what
  // `snapshot` returned during the break and at its end, for clocks whose controls can still
  // hold ad or pre-ad values when the ad flag disappears. `maximum` is free for the adapter.
  function adWatcher(snapshot = () => ({})) {
    const none = page => ({ page, active: false, generation: 0, maximum: null, leftover: {} });
    let ads = none('');
    function detect() {
      if ([...document.querySelectorAll('[data-ad-playing="true"], .ad-showing')].some(shown)) return true;
      const ad = document.querySelector('#ad-video-player');
      return !!ad && !ad.ended && ad.readyState >= 2 && (!ad.paused || shown(ad));
    }
    return {
      get state() { return ads; },
      observe() {
        if (ads.page !== location.pathname) ads = none(location.pathname);
        const active = detect();
        if (active || active !== ads.active) ads.leftover = snapshot();
        if (active !== ads.active) ads.generation++;
        ads.active = active;
        return active;
      }
    };
  }

  const html5 = {
    id: 'demo', name: 'Video', clockPolicy: 'media-v1',
    isWatchPage: () => true,
    episodeKey: () => location.pathname,
    contentVideo: largestVideo,
    overlayParent: () => document.fullscreenElement || document.body,
    adBreak: () => false,
    timelineSeconds: () => null,
    titleSeconds(video) { return globalThis.SubtitleCore.mediaDuration(video?.duration, this.timelineSeconds()); },
    // The element's own time is the title's time; there is nothing to calibrate or restore.
    subtitleTime(video) { return this.adBreak() || video.seeking || !Number.isFinite(video.currentTime) ? NaN : video.currentTime; },
    awaitingClock: () => false,
    clockState: video => ({ mediaTime: video?.currentTime }),
  };
  const adapters = [];
  const current = () => adapters.find(a => globalThis.SubtitleSites.identify(location.href) === a.id) || html5;
  const site = { get name() { return current().name; }, get id() { return current().id; }, get clockPolicy() { return current().clockPolicy; } };
  for (const method of ['isWatchPage', 'episodeKey', 'contentVideo', 'overlayParent', 'adBreak', 'timelineSeconds', 'titleSeconds', 'subtitleTime', 'awaitingClock', 'clockState']) site[method] = (...args) => current()[method](...args);
  // Only playback pages have a title on screen.
  const contentVideo = site.contentVideo; site.contentVideo = () => site.isWatchPage() ? contentVideo() : undefined;
  scope.SubtitlePlayers = { register(adapter) { adapters.push(Object.setPrototypeOf(adapter, html5)); }, html5, shown, deepFind, largestVideo, adWatcher };
  scope.SubtitleSite = site;
})(globalThis);
