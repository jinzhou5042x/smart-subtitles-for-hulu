import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { launchKeyPicker } from '../service/native-key-picker.mjs';

test('native bridge tracks actual handle, sends focus/cancel to the same process, and clears on close', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() {} });
  const commands = []; child.stdin.on('data', data => commands.push(String(data)));
  const states = [];
  const session = launchKeyPicker('load', state => states.push(state), { left: -1920, top: 10, width: 1920, height: 1080, topRatio: 0.1, heightRatio: 0.9 }, (command, args) => {
    assert.equal(args[1], String(process.pid));
    assert.equal(args[2], '-1920,10,1920,1080,0.1,0.9');
    return child;
  });
  child.stdout.write(JSON.stringify({ event: 'window', pid: 123, handle: '42' }) + '\n');
  assert.equal(states.at(-1).windowOpen, true); assert.equal(states.at(-1).windowId, '42');
  session.focus(); session.cancel();
  assert.deepEqual(commands, ['focus\n', 'cancel\n']);
  child.stdout.write(JSON.stringify({ event: 'result', path: '' }) + '\n');
  child.emit('close', 0);
  assert.equal(await session.result, '');
  assert.equal(states.at(-1).windowOpen, false); assert.equal(states.at(-1).pid, null);
});

test('native page centering supports monitors left of and above the primary monitor', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Add-Type -Path './service/key-picker.cs' -ReferencedAssemblies System.Windows.Forms,System.Drawing; [SubtitleKeyPicker]::Center(-1920,0,1920,1080,0.1,0.9,800,600) -join ','; [SubtitleKeyPicker]::Center(0,-1080,1920,1080,0.1,0.9,800,600) -join ','"], { encoding: 'utf8', windowsHide: true });
  assert.deepEqual(output.trim().split(/\r?\n/), ['-1360,294', '560,-786']);
});

 test('native picker closes cleanly after subprocess failure', { skip: !['win32', 'darwin'].includes(process.platform) }, async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 124, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() {} });
  const states = [];
  const session = launchKeyPicker('load', state => states.push(state), {}, () => child);
  const rejected = assert.rejects(session.result, /Cannot start the native file picker/);
  child.emit('error', new Error('launch failed'));
  await rejected;
  assert.equal(states.at(-1).phase, 'closed');
  assert.equal(states.at(-1).pid, null);
});
