// Shared by the service worker and content scripts. Keep permissions and message senders aligned.
(function (scope) {
  const domain = (host, root) => host === root || host.endsWith('.' + root);
  scope.SubtitleSites = {
    // Shown where the product says what it works on; the product name itself names no service.
    names: ['Hulu', 'Disney+'],
    matches: ['https://*.hulu.com/*', 'https://hulu.com/*', 'https://*.disneyplus.com/*', 'https://disneyplus.com/*', 'http://127.0.0.1/*'],
    identify(value) {
      try {
        const u = new URL(value);
        if (u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.pathname === '/demo') return 'demo';
        if (u.protocol !== 'https:') return null;
        if (domain(u.hostname, 'hulu.com')) return 'hulu';
        if (domain(u.hostname, 'disneyplus.com')) return 'disney';
      } catch {}
      return null;
    },
    // Only public Disney subtitle/manifest CDN URLs; never an account, license or media endpoint.
    subtitleResource(value) {
      try {
        const u = new URL(value);
        return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
          ['dssott.com', 'dssedge.com'].some(root => domain(u.hostname, root)) &&
          /\.(m3u8|vtt|webvtt|ttml|dfxp|srt)$/i.test(u.pathname);
      } catch { return false; }
    }
  };
})(globalThis);
