import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function loadConfig() {
  for (const dir of ['config', 'data', 'data/worker', 'logs']) await mkdir(path.join(root, dir), { recursive: true });
  const defaults = JSON.parse(await readFile(path.join(root, 'config/default.json'), 'utf8'));
  const localPath = path.join(root, 'config/local.json');
  let local;
  try { local = JSON.parse(await readFile(localPath, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; local = {}; }
  if (!local.pairingToken) {
    local.pairingToken = randomBytes(24).toString('hex');
    await writeFile(localPath, JSON.stringify(local, null, 2), { mode: 0o600 });
  }
  const config = { ...defaults, ...local };
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid port');
  return config;
}
