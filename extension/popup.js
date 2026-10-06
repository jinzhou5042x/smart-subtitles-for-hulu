import './languages.js';
const $ = id => document.getElementById(id);
const { list: languages } = globalThis.SubtitleLanguages;
// Target languages come from the shared list; with the local model only its languages can be chosen.
for (const language of languages) $('target').append(new Option(language.name, language.code));
const limitLanguages = () => { for (const option of $('target').options) option.disabled = $('provider').value === 'local' && !globalThis.SubtitleLanguages.get(option.value)?.local; };
const call = async message => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'Connection failed'); return result.data; };
async function player(message) { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab) return null; try { return await chrome.tabs.sendMessage(tab.id, message); } catch { return null; } }
function showError(message) { $('status').textContent = 'Cannot prepare subtitles right now'; $('detail').textContent = message; $('detail').hidden = false; $('retry').hidden = false; $('progress').hidden = true; }
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
    $('detail').hidden = true; $('retry').hidden = true;
    if (!$('enabled').checked) { $('status').textContent = 'Bilingual subtitles are off'; $('count').textContent = ''; $('progress').hidden = true; return; }
    if (!info?.video) { $('status').textContent = 'Open a Hulu video to start'; $('count').textContent = ''; $('progress').hidden = true; return; }
    $('status').textContent = info.status;
    $('detail').textContent = info.detail || '';
    $('detail').hidden = !info.detail;
    $('retry').hidden = !info.retry;
    $('count').textContent = '';
    $('progress').hidden = true;
  } catch { showError('Run "Start Subtitles.cmd" first'); }
}
try {
  const settings = await call({ type: 'settings' }); $('enabled').checked = settings.enabled; $('target').value = settings.target; wantedProvider = settings.provider || 'codex';
  $('fontSize').value = settings.fontSize; $('fontSizeValue').textContent = $('fontSize').value;
  const save = saveSettings = async () => { try { await call({ type: 'saveSettings', settings: { enabled: $('enabled').checked, target: $('target').value, provider: $('provider').value || wantedProvider } }); await refresh(); } catch (e) { showError(e.message); } };
  $('enabled').onchange = save; $('target').onchange = save; $('provider').onchange = () => { wantedProvider = $('provider').value; limitLanguages(); return save(); };
  let sizeTimer;
  $('fontSize').oninput = () => {
    $('fontSizeValue').textContent = $('fontSize').value;
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => call({ type: 'saveSettings', settings: { fontSize: Number($('fontSize').value) } }).catch(e => showError(e.message)), 80);
  };
  $('fontSize').onchange = () => { clearTimeout(sizeTimer); call({ type: 'saveSettings', settings: { fontSize: Number($('fontSize').value) } }).catch(e => showError(e.message)); };
  $('legal').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('legal.html') }); };
  $('retry').onclick = async () => { await player({ type: 'retry' }); await refresh(); };
  await refresh(); setInterval(refresh, 1500);
} catch (e) { showError(e.message); }
