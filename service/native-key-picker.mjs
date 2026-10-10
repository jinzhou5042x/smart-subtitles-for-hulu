import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { root } from './config.mjs';

function pickerExecutable() {
  if (process.platform === 'darwin') {
    const bundled = path.join(root, 'runtime/key-picker/picker');
    if (existsSync(bundled)) return bundled;
    const source = path.join(root, 'service/key-picker.swift');
    const hash = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16);
    const executable = path.join(root, `runtime/key-picker/picker-${hash}`);
    if (!existsSync(executable)) {
      mkdirSync(path.dirname(executable), { recursive: true });
      execFileSync('/usr/bin/swiftc', [source, '-o', executable], { stdio: 'pipe', timeout: 120000 });
    }
    return executable;
  }
  const source = path.join(root, 'service/key-picker.cs');
  const hash = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16);
  const directory = path.join(root, 'runtime/key-picker');
  const executable = path.join(directory, `picker-${hash}.exe`);
  if (!existsSync(executable)) {
    mkdirSync(directory, { recursive: true });
    const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    execFileSync(compiler, ['/nologo', '/target:winexe', `/out:${executable}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', source], { windowsHide: true, stdio: 'pipe', timeout: 15000 });
  }
  return executable;
}

export function launchKeyPicker(mode, report = () => {}, anchor = {}, launch = spawn) {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('File selection requires the Windows or macOS companion');
  if (mode !== 'load') throw new Error('Invalid key operation');
  const executable = pickerExecutable();
  const number = (value, fallback, min, max) => Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  const bounds = [number(anchor?.left, 0, -100000, 100000), number(anchor?.top, 0, -100000, 100000), number(anchor?.width, 0, 0, 20000), number(anchor?.height, 0, 0, 20000), number(anchor?.topRatio, 0, 0, 1), number(anchor?.heightRatio, 1, 0.01, 1)];
  const child = launch(executable, [mode, String(process.pid), bounds.join(',')], { windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let settled = false, resultPath, failure, lastHeartbeat = Date.now(), windowSeen = false, missingSince = 0, killTimer;
  const started = Date.now();
  const result = new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const finish = error => {
      if (settled) return; settled = true;
      clearInterval(watchdog); clearTimeout(killTimer); lines.close();
      report({ phase: 'closed', windowOpen: false, pid: null, windowId: null });
      error ? reject(error) : resolve(resultPath);
    };
    lines.on('line', line => {
      if (line.length > 16384) return;
      let event; try { event = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return; }
      if (event.event === 'window') {
        lastHeartbeat = Date.now();
        const windowOpen = event.handle !== '0';
        if (windowOpen) { windowSeen = true; missingSince = 0; }
        else if (windowSeen && !missingSince) missingSince = Date.now();
        report({ phase: windowOpen ? 'open' : 'starting', windowOpen, pid: child.pid, windowId: windowOpen ? event.handle : null });
      } else if (event.event === 'result' && typeof event.path === 'string') resultPath = event.path;
      else if (event.event === 'error') failure = new Error('The file selection window failed. Try again.');
    });
    // Consume stderr, but never log raw subprocess output or selected paths.
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('Cannot start the native file picker.')));
    child.on('close', () => finish(failure || (resultPath === undefined ? new Error('File selection closed unexpectedly. Try again.') : null)));
    const watchdog = setInterval(() => {
      if ((!windowSeen && Date.now() - started > 20000) || (windowSeen && Date.now() - lastHeartbeat > 10000) || (missingSince && Date.now() - missingSince > 3000)) {
        failure = new Error('File selection window stopped responding. Try again.'); child.kill();
      }
    }, 1000);
    watchdog.unref();
  });
  return {
    result, pid: child.pid,
    focus() { if (!settled && child.stdin.writable) child.stdin.write('focus\n'); },
    cancel() {
      if (settled) return;
      if (child.stdin.writable) child.stdin.write('cancel\n');
      killTimer = setTimeout(() => { if (!settled) child.kill(); }, 2000); killTimer.unref();
    }
  };
}
