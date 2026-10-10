import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { GoogleKeyPicker } from '../service/google-picker.mjs';
const key = 'x!'; // Nonempty input must not be rejected by a guessed Google key format.
const settle = () => new Promise(resolve => setImmediate(resolve));

function launcher(pick) {
  return (mode, report) => ({ pid: 123, result: pick(mode), focus() {}, cancel() {} });
}

test('load uses the selected file without a replacement key', async () => {
  let input;
  const picker = new GoogleKeyPicker({}, launcher(async () => path.resolve('existing.key')), async (c, value) => { input = value; });
  const { id } = picker.start({ mode: 'load', key });
  await settle();
  assert.equal(picker.get(id).status, 'done');
  assert.deepEqual(input, { file: path.resolve('existing.key') });
});

test('repeat requests rejoin and focus exactly one tracked window, including with no key', async () => {
  let finish, report, launches = 0, focuses = 0;
  const picker = new GoogleKeyPicker({}, (mode, callback) => {
    launches++; report = callback;
    return { pid: 123, result: new Promise(resolve => { finish = resolve; }), focus() { focuses++; }, cancel() { finish(''); } };
  }, async () => assert.fail('No save on cancel'));
  const first = picker.start({ mode: 'load' });
  assert.equal(first.phase, 'starting'); assert.equal(first.windowOpen, false);
  report({ phase: 'open', windowOpen: true, pid: 123, windowId: '42' });
  const second = picker.start({ mode: 'load' });
  assert.equal(second.id, first.id); assert.equal(second.windowId, '42');
  picker.focus(first.id);
  assert.equal(launches, 1); assert.equal(focuses, 2);
  picker.cancel(first.id); await settle();
  assert.equal(picker.get(first.id).status, 'cancelled');
  assert.equal(picker.get(first.id).windowOpen, false);
  assert.equal(picker.get(first.id).pid, null);
  picker.start({ mode: 'load' }); assert.equal(launches, 2);
  picker.close(); await settle();
});

test('unexpected native exit releases the operation and permits a new window', async () => {
  let launches = 0;
  const picker = new GoogleKeyPicker({}, launcher(async () => { launches++; throw new Error('Window process exited'); }));
  const { id } = picker.start({ mode: 'load' }); await settle();
  assert.equal(picker.get(id).status, 'error');
  assert.equal(picker.get(id).windowOpen, false);
  const next = picker.start({ mode: 'load' }); assert.notEqual(next.id, id); await settle();
  assert.equal(launches, 2);
});

test('unsupported modes never launch; saving and native window lifetime are distinct states', async () => {
  let finishSave, launches = 0;
  const picker = new GoogleKeyPicker({}, launcher(async () => { launches++; return path.resolve('keys'); }), () => new Promise(resolve => { finishSave = resolve; }));
  assert.throws(() => picker.start({ mode: 'save' }), /Invalid/);
  assert.throws(() => picker.start({ mode: 'other' }), /Invalid/);
  assert.equal(launches, 0);
  const { id } = picker.start({ mode: 'load' }); await settle();
  assert.equal(picker.get(id).phase, 'saving'); assert.equal(picker.get(id).windowOpen, false);
  assert.equal(picker.start({ mode: 'load' }).id, id); assert.equal(launches, 1);
  finishSave(); await settle(); assert.equal(picker.get(id).status, 'done');
});
