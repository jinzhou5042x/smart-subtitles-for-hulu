import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './config.mjs';

async function saveGoogle(config, input, configFile = path.join(root, 'config/local.json')) {
  const file = typeof input.file === 'string' ? input.file.trim() : '';
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!path.isAbsolute(file) || file.length > 1000 || /[\r\n\0]/.test(file)) throw new Error('Enter an absolute path to your API key file');
  if (key && !/^[A-Za-z0-9_-]{20,200}$/.test(key)) throw new Error('Enter a valid Google API key');
  if (file.startsWith('\\\\') || file.startsWith('//') || (process.platform === 'win32' && /:/.test(file.slice(2)))) throw new Error('Choose a local file, not a network or device path');
  if (key) {
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
      restrict(file);
      await handle.writeFile(key + '\n');
    } catch (error) {
      if (handle) { await handle.close(); handle = null; await unlink(file).catch(() => {}); }
      throw new Error(error.code === 'EEXIST' ? 'File already exists. Leave the key blank to use it, or choose a new filename.' : 'Cannot securely create the key file. Choose an existing local folder.');
    } finally { await handle?.close(); }
  }
  let saved;
  try {
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024) throw new Error();
      saved = (await handle.readFile('utf8')).trim();
    } finally { await handle.close(); }
  } catch { throw new Error('Cannot read that key file'); }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(saved)) throw new Error('The file must contain only a Google API key');
  const local = JSON.parse(await readFile(configFile, 'utf8'));
  const providers = [...new Set([...(config.providers || ['codex']), 'google'])];
  local.googleApiKeyFile = file; local.providers = providers; delete local.googleApiKey;
  const temporary = configFile + '.google.tmp';
  await writeFile(temporary, '', { mode: 0o600 });
  restrict(temporary);
  await writeFile(temporary, JSON.stringify(local, null, 2));
  await rename(temporary, configFile);
  config.googleApiKeyFile = file; config.providers = providers; delete config.googleApiKey;
  return { configured: true };
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
