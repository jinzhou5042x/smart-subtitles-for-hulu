import './languages.js';
import { playerMessage, playerState } from './popup-player.js';
const $ = id => document.getElementById(id);
const { list: languages } = globalThis.SubtitleLanguages;
// Target languages come from the shared list; with the local model only its languages can be chosen.
for (const language of languages) $('target').append(new Option(language.name, language.code));
const limitLanguages = () => { for (const option of $('target').options) option.disabled = $('provider').value === 'local' && !globalThis.SubtitleLanguages.get(option.value)?.local; };
const call = async message => { const result = await chrome.runtime.sendMessage(message); if (!result?.ok) throw new Error(result?.error || 'Connection failed'); return result.data; };
const player = message => playerMessage(chrome.tabs, message, undefined, chrome.scripting);
// One card: the headline (the count once there is one), a progress bar while it grows, one line
// of explanation and the actions that fit the state.
let confirming = false, shown = {};
function showState(state) {
  shown = state;
  const { tone = 'waiting', status, detail = '', total = 0, translated = 0, retry = false, complete = false, redo = false } = state;
  const counted = total > 0 && (tone === 'working' || tone === 'done' || translated > 0);
  const growing = counted && tone !== 'done';
  const percent = counted ? Math.min(100, Math.floor(translated / total * 100)) : 0;
  // While the Google key is not linked, its own row says what to do.
  $('card').hidden = (!status && !counted) || ($('provider').value === 'google' && !googleConfigured && !$('providerRow').hidden);
  $('card').dataset.tone = tone;
  $('percent').textContent = growing ? `${percent}%` : '';
  const problem = tone === 'error' || retry;
  const count = tone === 'done' ? `${total.toLocaleString()} subtitles ready` : `${translated.toLocaleString()} / ${total.toLocaleString()}`;
  $('status').textContent = counted && !problem ? count : status || '';
  $('status').className = counted || problem ? '' : 'plain';
  const lines = counted && !problem ? [tone === 'done' ? '' : redo ? 'Translating again' : status, detail] : [detail, counted ? `${count} translated` : ''];
  $('detail').textContent = lines.filter(Boolean).join(' · '); $('detail').hidden = !$('detail').textContent;
  $('meter').hidden = !growing;
  $('fill').style.width = `${percent}%`; $('meter').setAttribute('aria-valuenow', percent);
  $('retry').hidden = !retry;
  $('again').hidden = !(tone === 'done' && complete);
  if (!(tone === 'done' && complete)) confirming = false;
  $('actions').hidden = confirming || ($('retry').hidden && $('again').hidden);
  $('confirm').hidden = !confirming;
}
function showError(message) { showState({ tone: 'error', status: 'Cannot prepare subtitles right now', detail: message, retry: true }); }
// Shown until the extension holds the pairing code of the local service.
function showPairing(message = '') {
  $('pair').hidden = false; $('card').hidden = true;
  $('pairError').textContent = message; $('pairError').hidden = !message;
}
$('pair').onsubmit = async e => {
  e.preventDefault();
  const token = $('pairCode').value.trim().toLowerCase();
  try { await call({ type: 'pair', token, port: 43127 }); $('pair').hidden = true; await refresh(); }
  catch (error) { showPairing(error.message === 'NOT_PAIRED' ? 'The service did not accept this code. Copy it again from the service window.' : error.message === 'Failed to fetch' || /not running/.test(error.message) ? 'The subtitle service is not running. Start it, then try again.' : error.message); }
};
// The service decides which translators exist; the row is shown only when there is a choice.
const PROVIDER_NAMES = { codex: 'Codex', google: 'Google', local: 'Hy-MT2 (local)' };
// The few translators are shown side by side; the hidden <select> stays the one value everything reads.
const PROVIDER_SHORT = { local: 'Local' };
let pickerId = '';
let wantedProvider = 'codex', googleConfigured = false, googleKeyPath = '', codexState = '', codexAccount = {}, armed = false, saveSettings = async () => {};
// Codex cannot translate until it is installed (Set Up Codex) and signed in (the button here).
const CODEX_PROBLEMS = { 'signed-out': 'Not logged in', missing: 'Not installed' };
const codexProblem = () => $('provider').value === 'codex' ? CODEX_PROBLEMS[codexState] || '' : '';
function showGoogle() {
  // The Codex account lives in this row: logged in shows Log out, logged out shows Log in.
  // Every state comes from the service, so closing the popup or the ChatGPT page loses nothing,
  // and a login that is waiting can always be opened again or cancelled.
  const codex = $('provider').value === 'codex' ? codexState : '', waiting = codex === 'signed-out' && !!codexAccount.signingIn;
  if (codex !== 'ready') armed = false;
  $('codexSetup').hidden = !['ready', 'signed-out', 'missing'].includes(codex);
  $('codexState').textContent = waiting || armed ? '' : codex === 'ready' ? 'Logged in' : codex === 'signed-out' ? 'Not logged in' : CODEX_PROBLEMS[codex] || '';
  $('codexState').className = codex === 'ready' ? '' : 'problem';
  $('codexSignIn').hidden = codex !== 'signed-out'; $('codexSignIn').textContent = waiting ? 'Open page again' : 'Log in';
  $('codexSignIn').className = waiting ? 'quiet small' : 'primary';
  $('codexCancel').hidden = !waiting;
  $('codexSignOut').hidden = codex !== 'ready'; $('codexSignOut').textContent = armed ? 'Confirm log out' : 'Log out';
  $('codexNote').textContent = armed ? 'This logs Codex out on this computer, including other apps that use it. Running translations stop.'
    : codex === 'missing' ? 'Run Set Up Codex in the Smart Subtitles folder, then come back here.'
    : waiting ? 'Waiting for you to finish on the ChatGPT page in your browser.' : codex === 'signed-out' ? codexAccount.error || '' : '';
  $('codexNote').hidden = !$('codexNote').textContent;
  $('googleSetup').hidden = $('provider').value !== 'google';
  // The row shows the file's name; its full path is in the tooltip.
  $('googleLoad').textContent = googleKeyPath ? googleKeyPath.split(/[\\/]/).pop() : 'Choose file…';
  $('googleLoad').title = googleKeyPath ? `${googleKeyPath}\nChoose another API key file` : 'Choose your Google API key file';
  $('googleClear').hidden = !googleKeyPath;
}
function showProviders(list) {
  const select = $('provider');
  if (select.dataset.list !== list.join()) {
    select.dataset.list = list.join();
    select.replaceChildren(...list.map(p => new Option(PROVIDER_NAMES[p] || p, p)));
  }
  if (!list.includes(wantedProvider)) select.append(new Option(PROVIDER_NAMES[wantedProvider] || wantedProvider, wantedProvider));
  select.value = wantedProvider;
  const choices = [...select.options].map(option => option.value);
  if ($('providerChoice').dataset.list !== choices.join()) {
    $('providerChoice').dataset.list = choices.join();
    $('providerChoice').replaceChildren(...choices.map(value => {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role', 'radio'); button.dataset.value = value;
      button.textContent = PROVIDER_SHORT[value] || PROVIDER_NAMES[value] || value; button.title = PROVIDER_NAMES[value] || value;
      button.onclick = () => { if (select.value === value) return; select.value = value; select.dispatchEvent(new Event('change')); };
      return button;
    }));
  }
  for (const button of $('providerChoice').children) button.setAttribute('aria-checked', String(button.dataset.value === select.value));
  $('providerRow').hidden = list.length < 2;
  limitLanguages(); showGoogle();
  // Rendering the available choices must never rewrite the user's preference.
}
async function refresh() {
  try {
    try { const status = await call({ type: 'status' }); googleConfigured = !!status.googleConfigured;
      googleKeyPath = status.googleApiKeyFile || '';
      // A sign-in that has just succeeded lets a translation that stopped for it go on by itself.
      const signedIn = codexState === 'signed-out' && status.codex === 'ready';
      codexState = status.codex || ''; codexAccount = status.codexSignIn || {};
      if (signedIn) await player({ type: 'retry' }).catch(() => {});
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
    const state = playerState(tab, info, $('enabled').checked);
    // A translation that stopped while Codex is not signed in needs that fixed, not just a retry.
    showState(codexProblem() && (state.tone === 'error' || state.retry) ? { ...state, status: codexState === 'missing' ? 'Codex is not installed' : 'Log in to Codex', detail: codexState === 'missing' ? 'Run Set Up Codex, then press Retry.' : 'Use Log in below; the translation continues by itself.', retry: codexState === 'missing' } : state);
  } catch (error) { showError(error.message || 'Cannot connect to the subtitle service. Run Start Subtitles.command on Mac or Start Subtitles.cmd on Windows.'); }
}
try {
  const settings = await call({ type: 'settings' }); $('enabled').checked = settings.enabled; $('target').value = settings.target; wantedProvider = settings.provider || 'codex';
  // The slider's filled part follows its value (popup.css draws it from --fill).
  const paintSize = () => { const r = $('fontSize'); r.style.setProperty('--fill', `${(r.value - r.min) / (r.max - r.min) * 100}%`); $('fontSizeValue').textContent = r.value; };
  $('fontSize').value = settings.fontSize; paintSize();
  const save = saveSettings = async () => { try { await call({ type: 'saveSettings', settings: { enabled: $('enabled').checked, target: $('target').value, provider: $('provider').value || wantedProvider } }); await refresh(); } catch (e) { showError(e.message); } };
  $('enabled').onchange = save; $('target').onchange = save;
  $('provider').onchange = () => { wantedProvider = $('provider').value; for (const button of $('providerChoice').children) button.setAttribute('aria-checked', String(button.dataset.value === wantedProvider)); $('googleError').hidden = true; limitLanguages(); showGoogle(); return save(); };
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
  // What the page script and the service currently see, as text to paste into an issue report.
  $('copy').onclick = async e => {
    e.preventDefault();
    const label = text => { $('copy').textContent = text; setTimeout(() => { $('copy').textContent = 'Copy diagnostics'; }, 1600); };
    try {
      const [page, service] = await Promise.all([player({ type: 'snapshot' }).catch(() => null), call({ type: 'status' }).catch(error => ({ error: error.message }))]);
      const { googleApiKeyFile, googlePicker, ...shared } = service || {};
      await navigator.clipboard.writeText(JSON.stringify({ page, service: shared }, null, 2)); label('Copied');
    } catch { label('Could not copy'); }
  };
  $('issue').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: $('issue').href }); };
  // Log in, cancel a waiting login, or log out: each asks the service to run Codex's own command.
  // Logging out also logs out everything else on this computer that uses Codex, so it asks once more.
  for (const [button, action] of [['codexSignIn', 'sign-in'], ['codexCancel', 'cancel'], ['codexSignOut', 'sign-out']]) $(button).onclick = async () => {
    if (action === 'sign-out' && !armed) { armed = true; showGoogle(); return; }
    armed = false; $(button).disabled = true;
    try { codexAccount = await call({ type: 'codexAccount', action }); codexState = codexAccount.status || codexState; }
    catch (e) { codexAccount = { ...codexAccount, error: e.message }; }
    finally { $(button).disabled = false; showGoogle(); }
  };
  $('retry').onclick = async () => { await player({ type: 'retry' }); await refresh(); };
  // Translating again costs the translator's quota a second time, so it asks first.
  $('again').onclick = () => {
    const name = PROVIDER_NAMES[shown.provider] || 'the translator';
    $('confirmText').textContent = `Translate this video again with ${name}? ${shown.provider === 'codex' ? 'It uses your Codex quota again. ' : shown.provider === 'google' ? 'Google counts the characters again. ' : ''}The subtitles clear and return as they are translated; if it stops, the previous ones come back.`;
    confirming = true; showState(shown);
  };
  $('confirmNo').onclick = () => { confirming = false; showState(shown); };
  $('confirmYes').onclick = async () => {
    confirming = false;
    try { const result = await player({ type: 'retranslate' }); if (result && result.ok === false) throw new Error(result.error); await refresh(); }
    catch (e) { showError(e.message); }
  };
  await refresh(); setInterval(refresh, 1500);
} catch (e) { showError(e.message); }
