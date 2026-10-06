// The site profile: everything that depends on Hulu's web player. When Hulu changes its player,
// or another site (e.g. Hulu titles inside Disney+) is added, only this file needs to change.
// capture.js (subtitle discovery) is separate because it runs in the page's own JavaScript world.
(function (scope) {
  const demo = () => location.hostname === '127.0.0.1';
  const shown = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  };
  scope.SubtitleSite = {
    name: 'Hulu',
    // Episodes play on /watch/<id>. Autoplay of the next episode moves to a new path, so the path
    // identifies the episode whose subtitles are on screen.
    isWatchPage: () => demo() || location.pathname.startsWith('/watch/'),
    episodeKey: () => location.pathname,
    // The episode's own player. Ads play in a separate element, so the episode's currentTime is
    // the subtitles' time even around ad breaks.
    contentVideo() {
      if (!scope.SubtitleSite.isWatchPage()) return undefined;
      const content = document.querySelector('#content-video-player');
      if (content) return content.getBoundingClientRect().width > 0 ? content : undefined;
      return [...document.querySelectorAll('video')].filter(v => v.getBoundingClientRect().width > 200).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    },
    // A pre-roll or mid-roll ad break. The episode stands still meanwhile and its subtitles stay
    // hidden; a paused ad that is still on screen counts too, so subtitles never cover an ad.
    adBreak() {
      const ad = document.querySelector('#ad-video-player');
      if (!ad || ad.ended || ad.readyState < 2) return false;
      return !ad.paused || shown(ad);
    },
    // The player's timeline length in seconds; some titles report video.duration as Infinity.
    timelineSeconds: () => document.querySelector('.Timeline__slider[aria-label="Timeline"]')?.getAttribute('aria-valuemax'),
    // Where the overlay lives so it stays visible in full screen.
    overlayParent: () => document.fullscreenElement || document.body,
  };
})(globalThis);
