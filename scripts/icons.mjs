// Renders extension/icon.svg to the PNG icons Chrome needs (extension/icons/icon-<size>.png)
// with headless Chrome. Edit the SVG, then run `node scripts/icons.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../service/config.mjs';

const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');
const svg = pathToFileURL(path.join(root, 'extension/icon.svg')).href;
const work = await mkdtemp(path.join(tmpdir(), 'icons-'));
await mkdir(path.join(root, 'extension/icons'), { recursive: true });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = path.join(work, `${size}.html`);
    await writeFile(page, `<html><body style="margin:0;background:transparent"><img src="${svg}" width="${size}" height="${size}" style="display:block"></body></html>`);
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${path.join(root, `extension/icons/icon-${size}.png`)}`, pathToFileURL(page).href], { stdio: 'ignore' });
  }
} finally { await rm(work, { recursive: true, force: true }); }
console.log('Icons written to extension/icons');
