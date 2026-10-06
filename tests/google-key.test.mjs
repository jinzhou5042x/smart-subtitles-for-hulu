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
    await writeFile(file, '  test-key\n');
    await translator.translate(request);
    await writeFile(file, '');
    await assert.rejects(translator.translate(request), /Set googleApiKeyFile/);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('Google configuration stores only a path, never overwrites files or returns the key', async () => {
  const { configureGoogle } = await import('../service/google-settings.mjs');
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'subtitle-config-'));
  const configFile = path.join(dir, 'local.json'), file = path.join(dir, 'key.txt');
  const config = { providers: ['codex'] }, key = 'test_key_12345678901234567890';
  try {
    await writeFile(configFile, JSON.stringify({ pairingToken: 'existing' }));
    assert.deepEqual(await configureGoogle(config, { file, key }, configFile), { configured: true });
    const saved = await readFile(configFile, 'utf8');
    assert.equal(saved.includes(key), false);
    assert.equal(JSON.parse(saved).pairingToken, 'existing');
    assert.equal(config.googleApiKeyFile, file);
    assert.deepEqual(config.providers, ['codex', 'google']);
    await assert.rejects(configureGoogle(config, { file, key: 'another_key_123456789012345' }, configFile), /already exists/);
    assert.equal((await readFile(file, 'utf8')).trim(), key);
    await configureGoogle(config, { file, key: '' }, configFile);
    await assert.rejects(configureGoogle(config, { file: 'relative.txt', key }, configFile), /absolute/);
    await assert.rejects(configureGoogle(config, { file: '//server/share/key.txt', key }, configFile), /local/);
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
