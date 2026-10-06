// Sets the version everywhere it is written: node scripts/version.mjs 0.9.2 (or: npm run bump -- 0.9.2).
// package.json is read by the service, manifest.json by the extension (chrome.runtime.getManifest()).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next || '')) { console.error('Usage: node scripts/version.mjs <major.minor.patch>'); process.exit(1); }
for (const file of ['package.json', 'extension/manifest.json']) {
  const full = path.join(root, file), data = JSON.parse(await readFile(full, 'utf8'));
  console.log(`${file}: ${data.version} -> ${next}`); data.version = next;
  await writeFile(full, JSON.stringify(data, null, 2) + '\n');
}
const readme = path.join(root, 'README-DEVELOPMENT.md');
await writeFile(readme, (await readFile(readme, 'utf8')).replace(/Current version: \*\*[\d.]+\*\*/, `Current version: **${next}**`));
