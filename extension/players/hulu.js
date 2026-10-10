// Hulu. Everything that depends on Hulu's web player is in this file.
//
// Hulu plays the title in a dedicated element, #content-video-player, whose currentTime already
// is the subtitle track's time; ads play in a separate element. The integer UI timeline is less
// precise and must never introduce an offset (incident of 2026-10-06), so the clock is the
// ordinary html5 one: nothing to calibrate, nothing to restore after a reload.
(function (scope) {
  const P = scope.SubtitlePlayers, ads = P.adWatcher();
  P.register({
    id: 'hulu', name: 'Hulu', clockPolicy: 'hulu-media-v1',
    // Episodes play on /watch/<id>. Autoplay of the next episode moves to a new path, so the path
    // identifies the episode whose subtitles are on screen.
    isWatchPage: () => location.pathname.startsWith('/watch/'),
    // During player replacement, do not mistake the intro or ad video for the content.
    contentVideo() { const content = document.querySelector('#content-video-player'); return content && P.shown(content) ? content : undefined; },
    // A pre-roll or mid-roll ad break. The episode stands still meanwhile and its subtitles stay
    // hidden; a paused ad that is still on screen counts too, so subtitles never cover an ad.
    adBreak: () => ads.observe(),
    // The player's timeline length in seconds; some titles report video.duration as Infinity.
    timelineSeconds: () => document.querySelector('.Timeline__slider[aria-label="Timeline"]')?.getAttribute('aria-valuemax'),
  });
})(globalThis);
