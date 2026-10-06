import { execFileSync } from 'node:child_process';
import { loadConfig } from '../service/config.mjs';
import { codexCommand } from '../service/codex.mjs';
const config = await loadConfig();
console.log(`Node: ${process.version}`);
console.log(`Pairing code: ${config.pairingToken}`);
for (const args of [['--version'], ['login', 'status']]) {
  try { const { command, prefix } = codexCommand(config); console.log(execFileSync(command, [...prefix, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()); }
  catch (e) { console.error(`Codex unavailable: ${e.message}`); process.exitCode = 1; }
}
try { const r = await fetch(`http://127.0.0.1:${config.port}/status`, { headers: { Authorization: `Bearer ${config.pairingToken}` }, signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); console.log(await r.json()); }
catch { console.log('Local service is not running or needs restarting. Run "Start Subtitles.cmd"'); }
