import { readFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './config.mjs';

async function saveGoogle(config, input, configFile = path.join(root, 'config/local.json')) {
  if (input.clear === true) {
    const local = JSON.parse(await readFile(configFile, 'utf8'));
    // Explicitly unlinked: do not silently fall back to a legacy/environment key.
    local.googleApiKeyFile = null; delete local.googleApiKey;
    await persist(local, configFile);
    config.googleApiKeyFile = null; delete config.googleApiKey;
    return { configured: false };
  }
  const file = typeof input.file === 'string' ? input.file.trim() : '';
  if (!path.isAbsolute(file) || file.length > 1000 || /[\r\n\0]/.test(file)) throw new Error('Choose an absolute path to your API key file');
  if (file.startsWith('\\\\') || file.startsWith('//') || (process.platform === 'win32' && /:/.test(file.slice(2)))) throw new Error('Choose a local file, not a network or device path');
  let saved;
  try {
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16000) throw new Error();
      saved = (await handle.readFile('utf8')).trim();
    } finally { await handle.close(); }
  } catch { throw new Error('Cannot read that key file'); }
  if (!saved) throw new Error('The key file is empty');
  const local = JSON.parse(await readFile(configFile, 'utf8'));
  const providers = [...new Set([...(config.providers || ['codex']), 'google'])];
  local.googleApiKeyFile = file; local.providers = providers; delete local.googleApiKey;
  await persist(local, configFile);
  config.googleApiKeyFile = file; config.providers = providers; delete config.googleApiKey;
  return { configured: true };
}

async function persist(local, configFile) {
  const temporary = configFile + '.google.tmp';
  await writeFile(temporary, '', { mode: 0o600 });
  restrict(temporary);
  await writeFile(temporary, JSON.stringify(local, null, 2));
  await rename(temporary, configFile);
}

function restrict(file) {
  if (process.platform === 'win32') execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(F)`], { windowsHide: true, stdio: 'ignore' });
}
let saving = Promise.resolve();
export function configureGoogle(...args) {
  const result = saving.then(() => saveGoogle(...args));
  saving = result.catch(() => {});
  return result;
}
