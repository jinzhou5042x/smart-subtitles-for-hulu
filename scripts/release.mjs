// Builds the Windows companion service for users: dist/release/SmartSubtitlesForDisneyPlusAndHulu-Service-<version>-win-x64.zip
// - Only an allowlist of files is copied: the Codex backend, the shared language list and the
//   launch/setup scripts. config/local.json (pairing code, API keys), data, logs, models and the
//   development tools are never included; each user's first start creates their own pairing code.
// - Official portable Node.js is bundled after checking its SHA-256 against nodejs.org.
// - The result is scanned for the developer's secrets and anything that looks like a key.
import { cp, mkdir, readFile, rm, writeFile, readdir, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../service/config.mjs';

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const name = `SmartSubtitlesForDisneyPlusAndHulu-Service-${pkg.version}-win-x64`;
const releaseDir = path.join(root, 'dist/release'), out = path.join(releaseDir, name), cache = path.join(releaseDir, 'cache');
// Windows' own bsdtar (zip support); a GNU tar earlier on PATH would read 'C:' as a remote host.
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const sha256 = data => createHash('sha256').update(data).digest('hex');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true }); await mkdir(cache, { recursive: true });

const FILES = [
  'service/codex.mjs', 'service/config.mjs', 'service/database.mjs', 'service/episodes.mjs', 'service/jobs.mjs', 'service/server.mjs', 'service/translation.mjs',
  'service/checkpoints.mjs', 'service/keyed.mjs', 'service/google.mjs', 'service/google-settings.mjs', 'service/google-picker.mjs', 'service/key-picker.cs', 'service/native-key-picker.mjs',
  'shared/languages.js', 'config/default.json',
  'scripts/start.ps1', 'scripts/stop.ps1', 'scripts/setup-codex.ps1', 'scripts/configure-codex.mjs', 'scripts/doctor.mjs'
];
for (const file of FILES) { await mkdir(path.dirname(path.join(out, file)), { recursive: true }); await cp(path.join(root, file), path.join(out, file)); }
const defaults = JSON.parse(await readFile(path.join(out, 'config/default.json'), 'utf8'));
if (JSON.stringify(defaults.providers) !== '["codex"]') throw new Error('The release must enable Codex only');
await writeFile(path.join(out, 'package.json'), JSON.stringify({ name: 'smart-subtitles-for-disney-plus-and-hulu-service', version: pkg.version, private: true, type: 'module' }, null, 2) + '\n');
await cp(path.join(root, 'extension/legal.html'), path.join(out, 'TERMS-AND-PRIVACY.html'));
const launcher = command => `@echo off\r\ncd /d "%~dp0"\r\n${command}\r\npause\r\n`;
await writeFile(path.join(out, 'Start Subtitles.cmd'), launcher('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\start.ps1"'));
await writeFile(path.join(out, 'Stop Subtitles.cmd'), launcher('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\stop.ps1"'));
await writeFile(path.join(out, 'Set Up Codex.cmd'), launcher('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\setup-codex.ps1"'));
await writeFile(path.join(out, 'Check Environment.cmd'), launcher('"%~dp0node\\node.exe" scripts\\doctor.mjs'));
await writeFile(path.join(out, 'README.txt'), `Smart Subtitles for Disney+ & Hulu - companion service ${pkg.version} (Windows)
=====================================================================

The Chrome extension shows bilingual subtitles on Hulu. This service runs on your own computer,
translates the subtitles with Codex using your own ChatGPT sign-in, and keeps finished
translations in a local database. It only listens on 127.0.0.1 and requires a pairing code.

Install
  1. Unzip this folder somewhere permanent, for example Documents.
  2. Double-click "Set Up Codex.cmd" (once). It uses Codex if it is already installed, otherwise
     installs the official Codex CLI into this folder (about 430 MB download), and opens the ChatGPT
     sign-in in your browser. You need a ChatGPT account with Codex access.
  3. Double-click "Start Subtitles.cmd" and copy the pairing code it shows.
  4. Click the Smart Subtitles for Disney+ & Hulu extension icon in Chrome, paste the pairing code, click Connect.
  5. Open a Hulu video that has English subtitles and choose your language in the extension.

Every day
  Start: "Start Subtitles.cmd"   Stop: "Stop Subtitles.cmd"   Problems: "Check Environment.cmd"

Notes
  - Translation uses your ChatGPT/Codex quota. Subtitles are sent to OpenAI through your Codex
    account and to no one else; finished translations stay in the "data" folder.
  - Your pairing code is in config\\local.json, readable only by your Windows user. Do not share it.
  - To uninstall, run "Stop Subtitles.cmd" and delete this folder.
  - Unofficial tool, not affiliated with Hulu. See TERMS-AND-PRIVACY.html.
`.replace(/\n/g, '\r\n'));

// Official portable Node.js, the same version the service is developed and tested with.
const nodeVersion = process.version, nodeZip = `node-${nodeVersion}-win-x64.zip`, base = `https://nodejs.org/dist/${nodeVersion}/`;
const cached = path.join(cache, nodeZip);
if (!existsSync(cached)) {
  const response = await fetch(base + nodeZip); if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await writeFile(cached, Buffer.from(await response.arrayBuffer()));
}
const sums = await (await fetch(base + 'SHASUMS256.txt')).text();
const expected = sums.split('\n').find(line => line.endsWith('  ' + nodeZip))?.split(' ')[0];
if (!expected || expected !== sha256(await readFile(cached))) throw new Error(`${nodeZip} does not match the official SHA-256`);
execFileSync(tar, ['-xf', cached, '-C', out]);
await rename(path.join(out, `node-${nodeVersion}-win-x64`), path.join(out, 'node'));

// Secret scan: the developer's own values, and anything shaped like an API key or pairing code.
const own = JSON.parse(await readFile(path.join(root, 'config/local.json'), 'utf8'));
const secrets = [own.pairingToken, own.googleApiKey].filter(Boolean);
const patterns = [/AIza[0-9A-Za-z_-]{35}/, /\b[a-f0-9]{48}\b/, /sk-[A-Za-z0-9]{20,}/];
for (const file of await readdir(out, { recursive: true })) {
  if (file.startsWith('node' + path.sep)) continue; // official, checksum-verified Node.js files
  if (/local\.json$|\.sqlite$|local-connection\.json$/.test(file)) throw new Error(`Private file in the release: ${file}`);
  const full = path.join(out, file); if ((await stat(full)).isDirectory()) continue;
  const text = await readFile(full, 'utf8');
  if (secrets.some(s => text.includes(s)) || patterns.some(p => p.test(text))) throw new Error(`Possible secret in ${file}`);
}

const zip = path.join(releaseDir, `${name}.zip`);
await rm(zip, { force: true });
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', releaseDir, name]);
const digest = sha256(await readFile(zip));
await writeFile(zip + '.sha256.txt', `${digest}  ${name}.zip\n`);
console.log(`${zip}\n${Math.round((await stat(zip)).size / 1048576)} MB, SHA-256 ${digest}`);
