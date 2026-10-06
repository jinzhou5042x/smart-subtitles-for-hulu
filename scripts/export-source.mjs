// Copies the public source into a git working tree (default ../smart-subtitles-for-hulu-site) for
// the GitHub repository. Only an allowlist is copied: config/local.json (pairing code, API keys),
// data, logs, models, runtime and dist are never exported. The result is scanned for secrets.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../service/config.mjs';

const target = path.resolve(process.argv[2] || path.join(root, '../smart-subtitles-for-hulu-site'));
const SOURCE = ['extension', 'shared', 'service', 'scripts', 'tests', 'config/default.json', 'docs/VALIDATION.md', 'docs/store/LISTING.md', 'package.json', 'Start Subtitles.cmd', 'Stop Subtitles.cmd', 'Check Environment.cmd'];
for (const entry of [...SOURCE, 'docs', 'config', 'README-DEVELOPMENT.md']) await rm(path.join(target, entry), { recursive: true, force: true });
for (const entry of SOURCE) { await mkdir(path.dirname(path.join(target, entry)), { recursive: true }); await cp(path.join(root, entry), path.join(target, entry), { recursive: true }); }
await cp(path.join(root, 'README.md'), path.join(target, 'README-DEVELOPMENT.md'));
await cp(path.join(root, 'extension/legal.html'), path.join(target, 'index.html')); // GitHub Pages: Terms and Privacy
await writeFile(path.join(target, '.gitignore'), ['config/local.json', 'data/', 'logs/', 'dist/', 'models/', 'runtime/', 'codex/', 'node/', 'node_modules/', '*.sqlite', 'local-connection.json', ''].join('\n'));

const own = JSON.parse(await readFile(path.join(root, 'config/local.json'), 'utf8'));
const secrets = [own.pairingToken, own.googleApiKey].filter(Boolean);
const patterns = [/AIza[0-9A-Za-z_-]{35}/, /\b[a-f0-9]{48}\b/, /sk-[A-Za-z0-9]{20,}/];
for (const file of await readdir(target, { recursive: true })) {
  if (file.startsWith('.git' + path.sep) || file === '.git') continue;
  if (/(^|[\\/])local\.json$|\.sqlite$|local-connection\.json$/.test(file)) throw new Error(`Private file exported: ${file}`);
  const full = path.join(target, file); if ((await stat(full)).isDirectory() || /\.(mp4|png)$/.test(file)) continue;
  const text = await readFile(full, 'utf8');
  if (secrets.some(s => text.includes(s)) || patterns.some(p => p.test(text))) throw new Error(`Possible secret in ${file}`);
}
console.log(`Source exported to ${target}; secret scan passed.`);
