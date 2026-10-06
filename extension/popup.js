import './languages.js';
const $ = id => document.getElementById(id);
const { list: languages } = globalThis.SubtitleLanguages;
// Target languages come from the shared list; with the local model only its languages can be chosen.
for (const language of languages) $('target').append(new Option(language.name, language.code));
const limitLanguages = () => { for (const option of $('target').options) option.disabled = $('provider').value === 'local' && !globalThis.SubtitleLanguages.get(option.value)?.local; };
const call = async message => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'Connection failed'); return result.data; };
async function player(message) { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab) return null; try { return await chrome.tabs.sendMessage(tab.id, message); } catch { return null; } }
// The status area: a toned title and detail, the translated share of the episode, the time and the tokens Codex used.
// 950 -> "950", 12345 -> "12k", 999999 -> "1.00M" (the unit is chosen after rounding).
function tokens(n) {
  if (n < 1000) return String(n);
  const k = n / 1e3; if (k < 999.5) return `${k.toFixed(k < 9.95 ? 1 : 0)}k`;
  const m = n / 1e6; return `${m.toFixed(m < 9.995 ? 2 : 1)}M`;
}
const clock = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, pad = n => String(n).padStart(2, '0'); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`; };
function showState({ tone = 'waiting', status, detail = '', total = 0, translated = 0, elapsedMs = null, usage = null, retry = false }) {
  $('state').dataset.tone = tone; $('status').textContent = status;
  $('detail').textContent = detail; $('detail').hidden = !detail; $('retry').hidden = !retry;
  const showMeter = total > 0 && (tone === 'working' || tone === 'done' || translated > 0);
  $('meter').hidden = !showMeter;
  if (showMeter) {
    const percent = Math.min(100, Math.floor(translated / total * 100));
    $('fill').style.width = `${percent}%`; $('fill').parentElement.setAttribute('aria-valuenow', percent);
    $('count').textContent = tone === 'done' ? `${total.toLocaleString()} subtitles` : `${translated.toLocaleString()} / ${total.toLocaleString()} subtitles`;
    $('percent').textContent = `${percent}%`;
  }
  $('timeStat').hidden = elapsedMs == null;
  if (elapsedMs != null) $('elapsed').textContent = clock(elapsedMs);
  $('inputStat').hidden = $('outputStat').hidden = !usage;
  if (usage) {
    $('input').textContent = tokens(usage.input); $('output').textContent = tokens(usage.output);
    const share = usage.input ? Math.round(usage.cachedInput / usage.input * 100) : 0;
    $('cachedBar').style.width = `${share}%`; $('cached').textContent = `${share}% cached`;
    $('outputStat').title = `Output tokens, including ${usage.reasoning.toLocaleString()} reasoning tokens`;
    $('inputStat').title = `Input tokens: ${usage.input.toLocaleString()}, of which ${usage.cachedInput.toLocaleString()} cached (${share}%)`;
  }
  $('stats').hidden = elapsedMs == null && !usage;
}
function showError(message) { showState({ tone: 'error', status: 'Cannot prepare subtitles right now', detail: message, retry: true }); }
// Shown until the extension holds the pairing code of the local service.
function showPairing(message = '') {
  $('pair').hidden = false; document.querySelector('section').hidden = true;
  $('pairError').textContent = message; $('pairError').hidden = !message;
}
$('pair').onsubmit = async e => {
  e.preventDefault();
  const token = $('pairCode').value.trim().toLowerCase();
  try { await call({ type: 'pair', token, port: 43127 }); $('pair').hidden = true; document.querySelector('section').hidden = false; await refresh(); }
  catch (error) { showPairing(error.message === 'NOT_PAIRED' ? 'The service did not accept this code. Copy it again from the service window.' : error.message === 'Failed to fetch' || /not running/.test(error.message) ? 'The local service is not running; run "Start Subtitles.cmd".' : error.message); }
};
// The service decides which translators exist; the row is shown only when there is a choice.
const PROVIDER_NAMES = { codex: 'Codex', google: 'Google', local: 'Hy-MT2 (local)' };
let wantedProvider = 'codex', saveSettings = async () => {};
function showProviders(list) {
  const select = $('provider');
  if (select.dataset.list !== list.join()) {
    select.dataset.list = list.join();
    select.replaceChildren(...list.map(p => new Option(PROVIDER_NAMES[p] || p, p)));
  }
  select.value = list.includes(wantedProvider) ? wantedProvider : list[0];
  $('providerRow').hidden = list.length < 2;
  limitLanguages();
  if (select.value !== wantedProvider) { wantedProvider = select.value; void saveSettings(); }
}
async function refresh() {
  try {
    try { const status = await call({ type: 'status' }); showProviders(status.providers?.length ? status.providers : ['codex']); }
    catch (error) { if (error.message === 'NOT_PAIRED') return showPairing(); throw error; }
    const info = await player({ type: 'diagnostics' });
    if (!$('enabled').checked) return showState({ status: 'Bilingual subtitles are off' });
    if (!info?.video) return showState({ status: 'Open a Hulu video to start' });
    showState(info);
  } catch { showError('Run "Start Subtitles.cmd" first'); }
}
try {
  const settings = await call({ type: 'settings' }); $('enabled').checked = settings.enabled; $('target').value = settings.target; wantedProvider = settings.provider || 'codex';
  // The slider's filled part follows its value (popup.css draws it from --fill).
  const paintSize = () => { const r = $('fontSize'); r.style.setProperty('--fill', `${(r.value - r.min) / (r.max - r.min) * 100}%`); $('fontSizeValue').textContent = r.value; };
  $('fontSize').value = settings.fontSize; paintSize();
  const save = saveSettings = async () => { try { await call({ type: 'saveSettings', settings: { enabled: $('enabled').checked, target: $('target').value, provider: $('provider').value || wantedProvider } }); await refresh(); } catch (e) { showError(e.message); } };
  $('enabled').onchange = save; $('target').onchange = save; $('provider').onchange = () => { wantedProvider = $('provider').value; limitLanguages(); return save(); };
  let sizeTimer;
  $('fontSize').oninput = () => {
    paintSize();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => call({ type: 'saveSettings', settings: { fontSize: Number($('fontSize').value) } }).catch(e => showError(e.message)), 80);
  };
  $('fontSize').onchange = () => { clearTimeout(sizeTimer); call({ type: 'saveSettings', settings: { fontSize: Number($('fontSize').value) } }).catch(e => showError(e.message)); };
  $('legal').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('legal.html') }); };
  $('issue').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: $('issue').href }); };
  $('retry').onclick = async () => { await player({ type: 'retry' }); await refresh(); };
  await refresh(); setInterval(refresh, 1500);
} catch (e) { showError(e.message); }
