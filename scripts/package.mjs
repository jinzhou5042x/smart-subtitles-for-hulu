// Builds the Chrome Web Store upload: dist/store/smart-subtitles-for-hulu-<version>.zip.
// Unlike `npm run build`, it starts from extension/ (never dist/extension), so the developer's
// local-connection.json pairing file cannot be included; users pair in the popup instead.
// Content scripts run on Hulu only; 127.0.0.1 stays a host permission for the local service.
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../service/config.mjs';

const source = path.join(root, 'extension'), out = path.join(root, 'dist/store'), staging = path.join(out, 'extension');
// Keep dist/store/assets (store images); replace only the staged extension and old zips.
await mkdir(out, { recursive: true });
await rm(staging, { recursive: true, force: true });
for (const file of await readdir(out)) if (file.endsWith('.zip')) await rm(path.join(out, file));
await cp(source, staging, { recursive: true });
await cp(path.join(root, 'shared/languages.js'), path.join(staging, 'languages.js'));
await rm(path.join(staging, 'local-connection.json'), { force: true });

const manifestFile = path.join(staging, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
for (const script of manifest.content_scripts) script.matches = script.matches.filter(match => !match.startsWith('http://127.0.0.1'));
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

const zip = path.join(out, `smart-subtitles-for-hulu-${manifest.version}.zip`);
// Windows' bsdtar writes standard zip entries (forward slashes). PowerShell 5.1 Compress-Archive writes
// "icons\icon-16.png", which the Chrome Web Store rejects ("No manifest found in package").
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', staging, ...(await readdir(staging))], { stdio: 'inherit' });
const entries = execFileSync(tar, ['-t', '-f', zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
if (!entries.includes('manifest.json') || entries.some(e => e.includes('\\'))) throw new Error('The zip must have manifest.json at its root and forward-slash paths');

const files = await readdir(staging, { recursive: true });
if (files.some(file => /local-connection\.json$/.test(file))) throw new Error('The pairing file must not be packaged');
console.log(`${zip} (${Math.round((await stat(zip)).size / 1024)} KB, ${files.length} entries): ${files.sort().join(', ')}`);
