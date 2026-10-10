import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { codexCommand } from './codex.mjs';

// Whether the Codex this service uses can translate right now:
//   ready       found and signed in
//   signed-out  found, but `codex login status` says there is no sign-in
//   missing     the configured Codex is not on this computer
//   unknown     not asked yet, or the question itself failed (a timeout)
// Signing in belongs to Codex: its own `codex login` opens the browser and keeps the result.
// This starts that command and reads the answer; it never sees a credential.
export function codexLoginStatus(config) {
  const { command, prefix } = codexCommand(config);
  if ([command, ...prefix].some(part => path.isAbsolute(part) && !existsSync(part))) return Promise.resolve('missing');
  return new Promise(resolve => execFile(command, [...prefix, 'login', 'status'], { windowsHide: true, timeout: 10000 }, error => {
    resolve(!error ? 'ready' : error.code === 'ENOENT' ? 'missing' : error.killed || typeof error.code !== 'number' ? 'unknown' : 'signed-out');
  }));
}

// Starts Codex's own sign-in, which opens the ChatGPT page in the browser and then waits for it.
// The viewer may close that page, so the wait can always be ended: `cancel()` stops it, and it
// stops by itself after `timeout`. No argument comes from the request.
// `done` resolves with '' when the sign-in finished, or with why it did not.
export function codexSignIn(config, { run = spawn, timeout = 180000 } = {}) {
  const { command, prefix } = codexCommand(config);
  let child, reason = '';
  const done = new Promise(resolve => {
    try { child = run(command, [...prefix, 'login'], { stdio: 'ignore', windowsHide: true }); } catch (error) { return resolve(error.message); }
    const timer = setTimeout(() => { reason = 'The sign-in page was not completed in time'; child.kill(); }, timeout);
    child.once('error', error => { clearTimeout(timer); resolve(error.code === 'ENOENT' ? 'Codex is not installed' : error.message); });
    child.once('exit', code => { clearTimeout(timer); resolve(code === 0 ? '' : reason || 'Sign-in was not completed'); });
  });
  return { done, cancel() { reason = 'cancelled'; child?.kill(); } };
}

// Removes Codex's stored sign-in with its own `codex logout`. Resolves when it has ended.
export function codexSignOut(config, run = execFile) {
  const { command, prefix } = codexCommand(config);
  return new Promise(resolve => run(command, [...prefix, 'logout'], { windowsHide: true, timeout: 15000 }, () => resolve()));
}

// Keeps the last answer and asks again when it is old: every 5 seconds while Codex is not ready,
// so a sign-in shows up at once, and every 5 minutes while it is.
export class CodexAccount {
  constructor(config, probe = codexLoginStatus, now = Date.now, signIn = codexSignIn, signOut = codexSignOut) { this.config = config; this.probe = probe; this.now = now; this.signIn = signIn; this.signOutCommand = signOut; this.onAccountChange = () => {}; this.status = 'unknown'; this.checked = -Infinity; this.pending = null; this.attempt = null; this.signingIn = false; this.signInError = ''; }
  // At most one sign-in is open. Asking again replaces it, which opens the page again; it can
  // be cancelled, and it ends by itself. Nothing here can stay "waiting" without a way out.
  startSignIn() {
    this.attempt?.cancel();
    const attempt = this.attempt = this.signIn(this.config);
    this.signingIn = true; this.signInError = '';
    void Promise.resolve(attempt.done).catch(error => error.message).then(async problem => {
      if (this.attempt !== attempt) return; // replaced or cancelled meanwhile
      await this.refresh();
      if (this.attempt !== attempt) return;
      this.attempt = null; this.signingIn = false; this.signInError = this.status === 'ready' ? '' : problem || '';
      if (this.status === 'ready') this.onAccountChange();
    });
  }
  cancelSignIn() {
    const attempt = this.attempt; this.attempt = null; this.signingIn = false; this.signInError = '';
    attempt?.cancel();
  }
  // `onAccountChange` lets the service drop whatever still holds the previous account.
  async signOut() {
    this.cancelSignIn();
    await this.signOutCommand(this.config); await this.refresh(); this.onAccountChange();
  }
  // What the popup needs: the status, and the sign-in in progress or why the last one failed.
  describe() { return { status: this.get(), signingIn: this.signingIn, ...(this.signInError ? { error: this.signInError } : {}) }; }
  refresh() {
    this.pending ||= Promise.resolve(this.probe(this.config)).catch(() => 'unknown').then(status => { this.status = status; this.checked = this.now(); this.pending = null; return status; });
    return this.pending;
  }
  get() {
    if (this.now() - this.checked > (this.status === 'ready' ? 300000 : 5000)) void this.refresh();
    return this.status;
  }
}
