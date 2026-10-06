import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, root } from '../service/config.mjs';
const config = await loadConfig();
const destination = path.join(root, 'dist/extension');
await mkdir(destination, { recursive: true });
await cp(path.join(root, 'extension'), destination, { recursive: true });
// Shared with the service; the extension loads it as languages.js.
await cp(path.join(root, 'shared/languages.js'), path.join(destination, 'languages.js'));
await writeFile(path.join(destination, 'local-connection.json'), JSON.stringify({ port: config.port, token: config.pairingToken }), { mode: 0o600 });
console.log(`Chrome -> chrome://extensions -> Load unpacked: ${destination}`);
