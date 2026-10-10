import './languages.js';
import { playerMessage, playerState } from './popup-player.js';
const $ = id => document.getElementById(id);
const { list: languages } = globalThis.SubtitleLanguages;
// Target languages come from the shared list; with the local model only its languages can be chosen.
for (const language of languages) $('target').append(new Option(language.name, language.code));
const limitLanguages = () => { for (const option of $('target').options) option.disabled = $('provider').value === 'local' && !globalThis.SubtitleLanguages.get(option.value)?.local; };
const call = async message => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'Connection failed'); return result.data; };
const player = message => playerMessage(chrome.tabs, message, undefined, chrome.scripting);
function showState({ tone = 'waiting', status, detail = '', total = 0, translated = 0, retry = false }) {
  const showMeter = total > 0 && (tone === 'working' || tone === 'done' || translated > 0);
  const progressOnly = showMeter && tone !== 'error' && !retry;
  $('state').hidden = progressOnly || !status;
  $('state').dataset.tone = tone; $('status').textContent = status;
  $('detail').textContent = detail; $('detail').hidden = progressOnly || !detail;
  $('retry').hidden = !retry;
  $('meter').hidden = !showMeter;
  if (showMeter) {
    const percent = Math.min(100, Math.floor(translated / total * 100));
    $('fill').style.width = `${percent}%`; $('fill').parentElement.setAttribute('aria-valuenow', percent);
    $('count').textContent = tone === 'done' ? `${total.toLocaleString()} subtitles` : `${translated.toLocaleString()} / ${total.toLocaleString()} subtitles`;
    $('percent').textContent = `${percent}%`;
  }
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
let pickerId = '';
let wantedProvider = 'codex', googleConfigured = false, googleKeyPath = '', saveSettings = async () => {};
function showGoogle() {
  const selected = $('provider').value === 'google';
  $('googleSetup').hidden = !selected;
  $('googleKeyLabel').hidden = !googleKeyPath;
  $('googleLoad').textContent = googleKeyPath || 'Link API key file...';
  $('googleLoad').title = googleKeyPath ? 'Choose another API key file' : 'Choose your API key file';
  document.querySelector('section').hidden = selected && !googleConfigured;
}
function showProviders(list) {
  const select = $('provider');
  if (select.dataset.list !== list.join()) {
    select.dataset.list = list.join();
    select.replaceChildren(...list.map(p => new Option(PROVIDER_NAMES[p] || p, p)));
  }
  if (!list.includes(wantedProvider)) select.append(new Option(PROVIDER_NAMES[wantedProvider] || wantedProvider, wantedProvider));
  select.value = wantedProvider;
  $('providerRow').hidden = list.length < 2;
  limitLanguages(); showGoogle();
  // Rendering the available choices must never rewrite the user's preference.
}
async function refresh() {
  try {
    try { const status = await call({ type: 'status' }); googleConfigured = !!status.googleConfigured;
      googleKeyPath = status.googleApiKeyFile || '';
      const pick = status.googlePicker;
      const picking = pick?.status === 'pending';
      $('googleClear').disabled = picking;
      $('googleLoad').setAttribute('aria-disabled', String(picking && pick.phase === 'saving'));
      if (pick?.id && pick.id !== pickerId && pick.status !== 'pending') {
        pickerId = pick.id;
        if (pick.status === 'done') { wantedProvider = (await call({ type: 'settings' })).provider || 'google'; $('googleError').hidden = true; }
        if (pick.status === 'error') { $('googleError').textContent = pick.error; $('googleError').hidden = false; }
      }
      showProviders(status.availableProviders || (status.providers?.length ? status.providers : ['codex'])); }
    catch (error) { if (error.message === 'NOT_PAIRED') return showPairing(); throw error; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const info = tab ? await playerMessage(chrome.tabs, { type: 'diagnostics' }, tab, chrome.scripting) : null;
    showState(playerState(tab, info, $('enabled').checked));
  } catch { showError('Run "Start Subtitles.cmd" first'); }
}
try {
  const settings = await call({ type: 'settings' }); $('enabled').checked = settings.enabled; $('target').value = settings.target; wantedProvider = settings.provider || 'codex';
  // The slider's filled part follows its value (popup.css draws it from --fill).
  const paintSize = () => { const r = $('fontSize'); r.style.setProperty('--fill', `${(r.value - r.min) / (r.max - r.min) * 100}%`); $('fontSizeValue').textContent = r.value; };
  $('fontSize').value = settings.fontSize; paintSize();
  const save = saveSettings = async () => { try { await call({ type: 'saveSettings', settings: { enabled: $('enabled').checked, target: $('target').value, provider: $('provider').value || wantedProvider } }); await refresh(); } catch (e) { showError(e.message); } };
  $('enabled').onchange = save; $('target').onchange = save;
  $('provider').onchange = () => { wantedProvider = $('provider').value; $('googleError').hidden = true; limitLanguages(); showGoogle(); return save(); };
  $('googleLoad').onclick = async e => {
    e.preventDefault();
    if ($('googleLoad').getAttribute('aria-disabled') === 'true') return;
    $('googleError').hidden = true;
    try { await call({ type: 'pickGoogleKey', mode: 'load' }); await refresh(); }
    catch (error) { $('googleError').textContent = error.message; $('googleError').hidden = false; }
  };
  $('googleClear').onclick = async () => {
    $('googleClear').disabled = true; $('googleError').hidden = true;
    try { await call({ type: 'configureGoogle', clear: true }); await refresh(); }
    catch (error) { $('googleError').textContent = error.message; $('googleError').hidden = false; $('googleClear').disabled = false; }
  };
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
