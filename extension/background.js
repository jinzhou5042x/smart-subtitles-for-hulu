import './languages.js';
import './sites.js';
import { readSubtitleResource } from './subtitle-resource.js';
const DEFAULTS = { enabled: true, target: globalThis.SubtitleLanguages.defaultCode, sourceLanguage: 'en', provider: 'codex', fontSize: 60, subtitleOffset: 0 };
// Storage holds only what the user changed, so a new default applies until the user picks a value.
// Version 2 drops the font size that earlier versions stored along with every other default.
const SETTINGS_VERSION = 2;
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function stored() {
  const { settings = {}, settingsVersion } = await chrome.storage.local.get(['settings', 'settingsVersion']);
  if (settingsVersion === SETTINGS_VERSION) return settings;
  const { fontSize, ...rest } = settings;
  await chrome.storage.local.set({ settings: rest, settingsVersion: SETTINGS_VERSION });
  return rest;
}
async function store(changes) {
  const next = { ...await stored(), ...changes };
  await chrome.storage.local.set({ settings: next, settingsVersion: SETTINGS_VERSION });
  return settings();
}
async function settings() {
  const merged = { ...DEFAULTS, ...await stored() };
  if (!globalThis.SubtitleLanguages.get(merged.target)) merged.target = DEFAULTS.target;
  return merged;
}
async function connection() {
  const stored = await chrome.storage.local.get(['token', 'port']);
  if (stored.token) return { token: stored.token, port: stored.port || 43127 };
  // This file exists only in the local build and is not web-accessible.
  try { return await (await fetch(chrome.runtime.getURL('local-connection.json'))).json(); }
  catch { throw new Error('NOT_PAIRED'); }
}
async function request(route, method = 'GET', body) {
  const { token, port } = await connection();
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
  const data = await response.json();
  if (response.status === 401) throw new Error('NOT_PAIRED');
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function broadcastSettings(next, retryProvider) {
  const tabs = await chrome.tabs.query({ url: globalThis.SubtitleSites.matches });
  await Promise.allSettled(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'settingsChanged', settings: next, ...(retryProvider ? { retryProvider } : {}) })));
}
let watchingPicker = false;
async function restorePickerPopup(id) {
  const { googlePickerReturn } = await chrome.storage.session.get('googlePickerReturn');
  if (googlePickerReturn?.id !== id) return;
  // Consume once; status refreshes must never reopen a popup the user later dismisses.
  await chrome.storage.session.set({ googlePickerReturn: null });
  try {
    await chrome.windows.update(googlePickerReturn.windowId, { focused: true });
    await chrome.action.openPopup({ windowId: googlePickerReturn.windowId });
  } catch { /* The originating browser window may have been closed. */ }
}
async function watchPicker() {
  if (watchingPicker) return;
  watchingPicker = true;
  try {
    for (;;) {
      // Only the operation ID/status is persisted, never the API key or path.
      const { googlePicker } = await chrome.storage.session.get('googlePicker');
      if (!googlePicker || googlePicker.status !== 'pending') return;
      let state;
      try { state = await request(`/settings/google/picker?id=${encodeURIComponent(googlePicker.id)}`); }
      catch { state = { id: googlePicker.id, status: 'error', error: 'Cannot reach the companion. Reopen setup to try again.' }; }
      await chrome.storage.session.set({ googlePicker: state });
      if (state.status !== 'pending') {
        if (state.status === 'done') await broadcastSettings(await settings(), 'google');
        await chrome.storage.session.set({ googlePicker: state });
        await restorePickerPopup(state.id);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { watchingPicker = false; }
}
void watchPicker().catch(() => {});
function isContent(sender) { return !!sender.tab && !!globalThis.SubtitleSites.identify(sender.url); }
function isPopup(sender) { return !sender.tab && sender.url === chrome.runtime.getURL('popup.html'); }
const clients = new Map();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!isContent(sender) && !isPopup(sender)) return;
  (async () => {
    switch (message.type) {
      case 'settings': return settings();
      case 'saveSettings': {
        if (!isPopup(sender)) throw new Error('Popup only');
        const changes = { ...message.settings };
        if ('fontSize' in changes) changes.fontSize = Math.max(18, Math.min(100, Number(changes.fontSize) || DEFAULTS.fontSize));
        const next = await store(changes);
        const tabs = await chrome.tabs.query({ url: globalThis.SubtitleSites.matches });
        await Promise.allSettled(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'settingsChanged', settings: next })));
        return next;
      }
      case 'savePosition': {
        if (!isContent(sender) || !Number.isFinite(message.subtitleOffset)) throw new Error('Invalid position');
        return store({ subtitleOffset: Math.max(0, Math.min(0.85, message.subtitleOffset)) });
      }
      case 'pair': {
        if (!isPopup(sender) || !/^[a-f0-9]{48}$/.test(message.token) || !Number.isInteger(message.port) || message.port < 1024 || message.port > 65535) throw new Error('That is not a valid pairing code');
        await chrome.storage.local.set({ token: message.token, port: message.port }); return request('/status');
      }
      case 'status': {
        const status = await request('/status');
        if (status.googlePicker?.status === 'pending') {
          await chrome.storage.session.set({ googlePicker: status.googlePicker });
          void watchPicker().catch(() => {});
        }
        return status;
      }
      case 'focusGooglePicker':
      case 'cancelGooglePicker': {
        if (!isPopup(sender)) throw new Error('Popup only');
        return request('/settings/google/picker/' + (message.type === 'focusGooglePicker' ? 'focus' : 'cancel'), 'POST', { id: message.id });
      }
      case 'pickGoogleKey': {
        if (!isPopup(sender)) throw new Error('Popup only');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let anchor;
        if (tab?.windowId !== undefined) {
          const bounds = await chrome.windows.get(tab.windowId);
          anchor = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, topRatio: 0, heightRatio: 1 };
          try {
            const zoom = await chrome.tabs.getZoom(tab.id);
            const [{ result: viewport }] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, args: [zoom], func: zoom => {
              // inner dimensions use page CSS pixels; outer dimensions do not scale with page zoom.
              const border = Math.max(0, (window.outerWidth - window.innerWidth * zoom) / 2);
              return { topRatio: Math.max(0, window.outerHeight - window.innerHeight * zoom - border) / window.outerHeight, heightRatio: window.innerHeight * zoom / window.outerHeight };
            } });
            if (viewport?.topRatio >= 0 && viewport?.heightRatio > 0) Object.assign(anchor, viewport);
          } catch {}
        }
        const state = await request('/settings/google/picker', 'POST', { mode: 'load', anchor });
        await chrome.storage.session.set({ googlePicker: state, googlePickerReturn: { id: state.id, windowId: tab.windowId } });
        void watchPicker().catch(() => {});
        return state;
      }
      case 'configureGoogle': {
        if (!isPopup(sender)) throw new Error('Popup only');
        const result = await request('/settings/google', 'POST', message.clear ? { clear: true } : { file: message.file });
        await broadcastSettings(await settings(), result.configured ? 'google' : undefined);
        return result;
      }
      case 'codexAccount': {
        if (!isPopup(sender) || !['sign-in', 'sign-out', 'cancel'].includes(message.action)) throw new Error('Popup only');
        return request('/settings/codex/' + message.action, 'POST', {});
      }
      case 'subtitleResource': {
        if (!isContent(sender) || globalThis.SubtitleSites.identify(sender.url) !== 'disney') throw new Error('Disney+ player only');
        return readSubtitleResource(message.url);
      }
      case 'prepareEpisode': {
        if (!isContent(sender)) throw new Error('Player only');
        const config = await settings(); if (!config.enabled) throw new Error('Subtitles are turned off');
        // Selection is a preference, not proof that setup has finished. Check the
        // companion before sending any subtitle text or creating a translation job.
        if (config.provider === 'google') {
          const status = await request('/status');
          if (!status.googleConfigured || !status.providers?.includes('google')) return { status: 'awaiting-key' };
        }
        const client = `tab-${sender.tab.id}-${sender.frameId || 0}`;
        const tabClients = clients.get(sender.tab.id) || new Set(); tabClients.add(client); clients.set(sender.tab.id, tabClients);
        await chrome.tabs.get(sender.tab.id);
        const result = await request('/episodes', 'POST', { ...message.request, client, target: config.target, provider: config.provider });
        try { await chrome.tabs.get(sender.tab.id); } catch { await request('/cancelTab', 'POST', { tabId: sender.tab.id }); throw new Error('The video was closed'); }
        return result;
      }
      case 'episodeProgress': {
        if (!isContent(sender) || !/^[a-f0-9]{64}$/.test(message.id) || !Number.isInteger(message.after) || message.after < 0) throw new Error('Invalid episode');
        return request(`/episodes/${message.id}?after=${message.after}`);
      }
      case 'cancel': {
        if (!isContent(sender)) throw new Error('Player only');
        return request('/cancel', 'POST', { client: `tab-${sender.tab.id}-${sender.frameId || 0}`, epoch: message.epoch });
      }
      default: throw new Error('Unknown message');
    }
  })().then(data => respond({ ok: true, data }), e => respond({ ok: false, error: e.message === 'Failed to fetch' ? 'Cannot connect to the subtitle service. Run Start Subtitles.command on Mac or Start Subtitles.cmd on Windows.' : e.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { clients.delete(tabId); request('/cancelTab', 'POST', { tabId }).catch(() => {}); });
