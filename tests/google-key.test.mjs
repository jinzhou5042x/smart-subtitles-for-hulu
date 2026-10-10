import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GoogleTranslator } from '../service/google.mjs';

test('chosen key file is read directly, takes precedence, and fails closed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'subtitle-key-'));
  const file = path.join(dir, 'key.txt');
  let calls = 0;
  const translator = new GoogleTranslator({ googleApiKeyFile: file, googleApiKey: 'legacy' }, async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.equal(url, 'https://translation.googleapis.com/language/translate/v2');
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-key');
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: 'Bonjour' }] } }));
  });
  const request = { target: 'fr', cues: [{ id: 'c0', start: 0, end: 1, text: 'Hello' }] };
  try {
    await assert.rejects(translator.translate(request), /Cannot read googleApiKeyFile/);
    await writeFile(file, '\uFEFF \t\r\ntest-key \t\r\n');
    await translator.translate(request);
    await writeFile(file, '');
    await assert.rejects(translator.translate(request), /Set googleApiKeyFile/);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('linking stores only a path, strips surrounding whitespace, and never modifies key files', async () => {
  const { configureGoogle } = await import('../service/google-settings.mjs');
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'subtitle-config-'));
  const configFile = path.join(dir, 'local.json'), first = path.join(dir, 'first.txt'), second = path.join(dir, 'second.txt');
  const config = { providers: ['codex'] };
  const original = '\uFEFF \t\r\nx! \r\n';
  try {
    await writeFile(configFile, JSON.stringify({ pairingToken: 'existing' }));
    await writeFile(first, original); await writeFile(second, 'second-key\r\n');
    assert.deepEqual(await configureGoogle(config, { file: first }, configFile), { configured: true });
    assert.equal(config.googleApiKeyFile, first);
    assert.equal(await readFile(first, 'utf8'), original);
    await configureGoogle(config, { file: second }, configFile);
    assert.equal(config.googleApiKeyFile, second);
    assert.equal(await readFile(second, 'utf8'), 'second-key\r\n');
    const saved = await readFile(configFile, 'utf8');
    assert.equal(saved.includes('second-key'), false);
    assert.equal(JSON.parse(saved).pairingToken, 'existing');
    const empty = path.join(dir, 'empty.txt'); await writeFile(empty, ' \r\n\t');
    await assert.rejects(configureGoogle(config, { file: empty }, configFile), /empty/);
    await assert.rejects(configureGoogle(config, { file: path.join(dir, 'missing.txt') }, configFile), /Cannot read/);
    await assert.rejects(configureGoogle(config, { file: dir }, configFile), /Cannot read/);
    assert.equal(config.googleApiKeyFile, second);
    assert.equal(await readFile(configFile, 'utf8'), saved);
    assert.deepEqual(await configureGoogle(config, { clear: true }, configFile), { configured: false });
    assert.equal(config.googleApiKeyFile, null);
    assert.equal(JSON.parse(await readFile(configFile, 'utf8')).googleApiKeyFile, null);
    assert.equal(await readFile(second, 'utf8'), 'second-key\r\n');
    const translator = new GoogleTranslator({ ...config, googleApiKey: 'legacy' }, () => assert.fail('Cleared key must not fall back'));
    await assert.rejects(translator.translate({ cues: [], target: 'fr' }), /Link your/);
    await configureGoogle(config, { file: second }, configFile);
    assert.equal(config.googleApiKeyFile, second);
    await assert.rejects(configureGoogle(config, { file: 'relative.txt' }, configFile), /absolute/);
    await assert.rejects(configureGoogle(config, { file: '//server/share/key.txt' }, configFile), /local/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Google resumes saved cues and reports validated progress without translating them again', async () => {
  const cues = [0, 60, 120].map((start, i) => ({ id: String(i), start, end: start + 2, text: `source ${i}` }));
  const accepted = [{ sourceIds: ['0'], text: 'saved' }], progress = [];
  const translator = new GoogleTranslator({ googleApiKey: 'test-key' }, async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).q, ['source 1', 'source 2']);
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: 'one' }, { translatedText: 'two' }] } }));
  });
  const result = await translator.translate({ target: 'fr', cues, accepted }, undefined, p => progress.push(p));
  assert.equal(result.length, 3); assert.equal(result[0].text, 'saved');
  assert.equal(progress[0].partialSegments.length, 3);
});
