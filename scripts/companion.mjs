import { spawn } from 'node:child_process';
import { open, chmod } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, root } from '../service/config.mjs';
const config = await loadConfig();
await chmod(path.join(root, 'config/local.json'), 0o600);
const base = `http://127.0.0.1:${config.port}`;
const headers = { Authorization: `Bearer ${config.pairingToken}` };
async function status() {
  try {
    const response = await fetch(`${base}/status`, { headers, signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}
const action = process.argv[2];
if (action === 'stop') {
  if (await status()) {
    const response = await fetch(`${base}/shutdown`, { method: 'POST', headers, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Stop failed: HTTP ${response.status}`);
    console.log('Subtitle service stopped.');
  } else console.log('No paired subtitle service is running.');
} else if (action === 'start') {
  if (!await status()) {
    const stdout = await open(path.join(root, 'logs/stdout.log'), 'a', 0o600);
    const stderr = await open(path.join(root, 'logs/stderr.log'), 'a', 0o600);
    const child = spawn(process.execPath, [path.join(root, 'service/server.mjs')], { cwd: root, detached: true, stdio: ['ignore', stdout.fd, stderr.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); await stdout.close(); await stderr.close();
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await status()) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Service did not start. Check logs/stderr.log and Check Environment.command.');
  }
  // Say at start, not at the first translation, that Codex still needs setting up.
  try {
    let codex = 'unknown';
    for (let attempt = 0; attempt < 20 && codex === 'unknown'; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 250));
      codex = (await (await fetch(`${base}/status`, { headers, signal: AbortSignal.timeout(1500) })).json()).codex;
    }
    if (codex === 'missing') console.log('Codex is not installed: run the Set Up Codex launcher before translating with Codex.');
    if (codex === 'signed-out') console.log('Codex is not logged in: use Log in in the extension popup before translating with Codex.');
  } catch { /* the line below still applies */ }
  console.log(`Subtitle service is running.\nPairing code: ${config.pairingToken}\nLoad dist/extension in chrome://extensions for a development checkout.`);
} else throw new Error('Usage: companion.mjs start|stop');
