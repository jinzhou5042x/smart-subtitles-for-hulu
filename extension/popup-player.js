import './sites.js';

// Content scripts also run in frames. The popup belongs to the main player page,
// so unrelated child-frame responses must not win the diagnostics request.
// The isolated-world scripts in the manifest's order; a test keeps the two lists equal.
export const PAGE_SCRIPTS = ['sites.js', 'core.js', 'ttml.js', 'site.js', 'players/hulu.js', 'players/disney.js', 'tracks.js', 'session.js', 'overlay.js', 'content.js'];
const reconnecting = new Map();
const attempted = new Map();
const failures = new Map();
const connectionIssue = detail => ({ connectionIssue: true, status: 'Extension connection unavailable', detail });
export async function playerMessage(tabs, message, tab, scripting) {
  if (!tab) [tab] = await tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try { return await tabs.sendMessage(tab.id, message, { frameId: 0 }); }
  catch {
    if (message.type !== 'diagnostics' || tab.status === 'loading' || !globalThis.SubtitleSites.identify(tab.url)) return null;
    if (typeof scripting?.executeScript !== 'function') return connectionIssue('Reload this extension in chrome://extensions to finish applying the update.');
    // Coalesce popup polls and avoid reinjecting repeatedly when access is denied.
    const key = `${tab.id}|${tab.url}`;
    if (!reconnecting.has(key)) {
      if (Date.now() - (attempted.get(key) || 0) < 10000) return failures.get(key) || null;
      attempted.set(key, Date.now());
      reconnecting.set(key, (async () => {
        const target = { tabId: tab.id, frameIds: [0] };
        await scripting.executeScript({ target, world: 'MAIN', files: ['sites.js', 'capture.js'] });
        await scripting.executeScript({ target, world: 'ISOLATED', files: PAGE_SCRIPTS });
        return tabs.sendMessage(tab.id, message, { frameId: 0 });
      })());
    }
    try { const result = await reconnecting.get(key); failures.delete(key); return result; }
    catch (error) {
      // Preserve the actual failure locally; never label all failures as denied site access.
      console.warn('Subtitle connection recovery failed:', error);
      const state = connectionIssue('Could not attach the subtitle extension to this page.');
      failures.set(key, state); return state;
    }
    finally { reconnecting.delete(key); }
  }
}

export function playerState(tab, info, enabled) {
  if (!enabled) return { status: 'Bilingual subtitles are off' };
  // Preserve loading, capture and connection errors reported by the content script,
  // even before it has found a video element.
  if (info) {
    if (info.connectionIssue) return info;
    // Capture diagnostics belong to internal inspection, not the watching UI.
    if (!info.total && !info.error) return { status: '', detail: '', retry: false };
    return info;
  }
  if (!globalThis.SubtitleSites.identify(tab?.url)) return { status: `Open a video on ${new Intl.ListFormat('en', { type: 'disjunction' }).format(globalThis.SubtitleSites.names)}` };
  if (tab.status === 'loading') return { status: 'Connecting to the video…' };
  return { status: '', detail: '', retry: false };
}
