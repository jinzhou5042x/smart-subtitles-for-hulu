// Records which Codex the service uses, in config/local.json:
//   node scripts/configure-codex.mjs bundled         -> node\node.exe + codex\...\codex.js (installed by Set Up Codex)
//   node scripts/configure-codex.mjs path <codex.exe> -> an existing Codex installation
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, root } from '../service/config.mjs';

await loadConfig(); // creates config/local.json and the pairing code if needed
const file = path.join(root, 'config/local.json');
const config = JSON.parse(await readFile(file, 'utf8'));
const [mode, executable] = process.argv.slice(2);
if (mode === 'bundled') config.codexPath = ['node/node.exe', 'codex/node_modules/@openai/codex/bin/codex.js'];
else if (mode === 'path' && executable) config.codexPath = executable;
else { console.error('Usage: configure-codex.mjs bundled | path <codex.exe>'); process.exit(1); }
await writeFile(file, JSON.stringify(config, null, 2));
console.log(`Codex: ${Array.isArray(config.codexPath) ? config.codexPath.join(' ') : config.codexPath}`);
