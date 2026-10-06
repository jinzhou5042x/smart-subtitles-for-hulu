import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { root } from './config.mjs';
import { LOCAL_MODEL, LOCAL_PROMPT_VERSION, languages, languageName, validateTranslation } from './translation.mjs';
import { episodeHash } from './database.mjs';
import { collectTerms, isWideTarget, localGrammar, localPrompt, mergeUnits, outputBudget, parseLocalTranslation, pickTerms, planBatches, sourceText, termsPrompt } from './local-format.mjs';

export { LOCAL_MODEL, LOCAL_PROMPT_VERSION };
export { localGrammar, localPrompt, parseLocalTranslation } from './local-format.mjs';
const RETRY_TEMPERATURE = 0.2;
const covered = segments => segments.reduce((n, s) => n + s.sourceIds.length, 0);
function contextBefore(segments, byId, count = 4) {
  const out = [];
  for (let k = segments.length - 1, cues = 0; k >= 0 && cues < count; k--) {
    const s = segments[k]; cues += s.sourceIds.length;
    out.unshift({ source: s.sourceIds.map(id => sourceText(byId.get(id))).join(' ').slice(0, 400), translation: s.text.slice(0, 400) });
  }
  return out;
}

export class LocalTranslator {
  constructor(config, fetcher = fetch) {
    this.config = config; this.fetcher = fetcher; this.process = null; this.starting = null;
    this.tables = new Map(); this.contextSize = null; this.active = 0; this.idleTimer = null;
    this.url = `http://127.0.0.1:${config.localModelPort || 43128}`;
  }
  get headers() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.pairingToken}` }; }
  async ready() {
    try { const r = await this.fetcher(`${this.url}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.boot().finally(() => { this.starting = null; });
    return this.starting;
  }
  async boot() {
    if (await this.ready()) { await this.readContextSize(); return; }
    const binary = path.join(root, 'runtime/llama.cpp/llama-server.exe');
    const model = path.join(root, 'models/Hy-MT2-7B/HY-MT2-7B-Q8_0.gguf');
    await access(binary); await access(model);
    const log = createWriteStream(path.join(root, 'logs/local-model.log'), { flags: 'a' });
    const speculation = this.config.localSpeculation === false ? [] : ['--spec-type', 'ngram-simple', '--spec-ngram-simple-size-n', '4', '--spec-ngram-simple-size-m', '16'];
    const child = spawn(binary, ['--model', model, '--alias', LOCAL_MODEL, '--host', '127.0.0.1', '--port', String(this.config.localModelPort || 43128), '--ctx-size', String(this.config.localContextSize || 16384), '--parallel', '1', '--gpu-layers', String(this.config.localGpuLayers ?? 99), '--cache-type-k', 'f16', '--cache-type-v', 'f16', '--flash-attn', 'on', '--batch-size', '512', '--ubatch-size', '128', '--jinja', '--no-webui', '--no-context-shift', '--offline', ...speculation], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LLAMA_API_KEY: this.config.pairingToken } });
    this.process = child; let failed;
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once('error', error => { failed = error; log.end(); });
    child.once('exit', code => { failed = new Error(`The local model exited (${code}); see logs/local-model.log`); if (this.process === child) this.process = null; log.end(); });
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (failed) throw failed;
      if (await this.ready()) { await this.readContextSize(); return; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    child.kill(); throw new Error('The local model took too long to load; see logs/local-model.log');
  }
  // A model server left running by an earlier instance may use a different context size than the config.
  async readContextSize() {
    try {
      const r = await this.fetcher(`${this.url}/props`, { headers: this.headers, signal: AbortSignal.timeout(3000) });
      const size = r.ok ? (await r.json()).default_generation_settings?.n_ctx : null;
      this.contextSize = Number.isInteger(size) && size > 0 ? size : null;
    } catch { this.contextSize = null; }
  }
  close() { clearTimeout(this.idleTimer); this.process?.kill(); this.contextSize = null; }
  // Cancelling keeps the model loaded for the next request; it is released after a period without work.
  scheduleUnload() {
    clearTimeout(this.idleTimer);
    const delay = this.config.localIdleUnloadMs ?? 600000;
    if (!delay || !this.process) return;
    this.idleTimer = setTimeout(() => { if (!this.active) this.close(); }, delay);
    this.idleTimer.unref?.();
  }

  async translate(request, signal, progress = () => {}) {
    if (!languages.get(request.target)?.local) throw new Error(`The local model cannot translate into ${languageName(request.target)}; choose Codex or Google`);
    this.active++; clearTimeout(this.idleTimer);
    try { return await this.translateEpisode(request, signal, progress); }
    finally { if (!--this.active) this.scheduleUnload(); }
  }
  async translateEpisode(request, signal, progress) {
    const { cues } = request, byId = new Map(cues.map(c => [c.id, c])), wide = isWideTarget(request.target);
    // A retry continues after the batches already accepted (request.accepted, kept in memory by the
    // episode manager); the name and sound tables of the episode are reused from memory.
    const key = episodeHash(request), tables = this.tables.get(key) || { sounds: {} };
    this.tables.delete(key); this.tables.set(key, tables);
    while (this.tables.size > 8) this.tables.delete(this.tables.keys().next().value);
    const accepted = request.accepted || [];
    const segments = covered(accepted) ? [...validateTranslation({ segments: accepted }, cues.slice(0, covered(accepted)))] : [];
    const { sounds } = tables;
    let { terms } = tables;
    const status = extra => ({ provider: 'local', totalCues: cues.length, lastActivity: Date.now(), ...extra });
    if (segments.length) progress(status({ phase: 'local_receiving', completedCues: covered(segments), generatedCues: covered(segments), resumed: true, partialSegments: [...segments] }));
    if (!terms) {
      const candidates = collectTerms(cues);
      terms = candidates.length ? await this.translateTerms(request, candidates, signal, p => progress(status({ ...p, phase: 'local_terms', totalCues: cues.length, completedCues: covered(segments), generatedCues: covered(segments) }))) : {};
      tables.terms = terms;
    }
    const glossary = { ...terms, ...(this.config.glossary || {}) };
    const size = Math.max(1, Math.min(100, this.config.localBatchSize || 20));
    const batches = planBatches(cues, covered(segments), size);
    let outputChars = 0;
    for (let i = 0; i < batches.length; i++) {
      signal?.throwIfAborted();
      const { start, end } = batches[i];
      const batchCues = cues.slice(start, end);
      const batchContext = { before: contextBefore(segments, byId), after: cues.slice(end, end + 4).map(c => sourceText(c).slice(0, 400)) };
      const texts = [...batchCues.map(sourceText), ...batchContext.before.map(c => c.source), ...batchContext.after];
      let batchChars = 0;
      const translated = await this.translateWithRetry({ ...request, cues: batchCues, batchContext, glossary: pickTerms(glossary, texts), sounds, wide }, signal, p => {
        batchChars = Math.max(batchChars, p.outputChars || 0);
        progress(status({ ...p, outputChars: outputChars + batchChars, generatedCues: start + (p.generatedCues || 0), totalCues: cues.length, completedCues: start, batch: i + 1, totalBatches: batches.length, partialSegments: segments }));
      });
      signal?.throwIfAborted();
      segments.push(...translated); outputChars += batchChars;
      progress(status({ phase: 'local_receiving', outputChars, generatedCues: end, completedCues: end, batch: i + 1, totalBatches: batches.length, partialSegments: [...segments] }));
    }
    signal?.throwIfAborted();
    const result = validateTranslation({ segments }, cues);
    this.tables.delete(key);
    return result;
  }
  // A batch that fails validation is retried more conservatively, then split in half,
  // so one difficult passage cannot fail a whole episode.
  async translateWithRetry(request, signal, progress) {
    let lastError;
    for (const temperature of [undefined, RETRY_TEMPERATURE]) {
      try { return await this.translateBatch(request, signal, progress, { temperature }); }
      catch (error) {
        signal?.throwIfAborted(); lastError = error;
        if (error.capacity) break;
        progress({ phase: 'local_retrying', provider: 'local', lastActivity: Date.now() });
      }
    }
    if (request.cues.length < 2) {
      // Suspicious but well-formed output for a single subtitle is accepted rather than failing the episode.
      if (lastError?.soft) return this.translateBatch(request, signal, progress, { temperature: RETRY_TEMPERATURE, lenient: true });
      throw lastError;
    }
    const half = Math.ceil(request.cues.length / 2), byId = new Map(request.cues.map(c => [c.id, c]));
    const { before = [], after = [] } = request.batchContext || {};
    const first = await this.translateWithRetry({ ...request, cues: request.cues.slice(0, half), batchContext: { before, after: request.cues.slice(half, half + 4).map(c => sourceText(c).slice(0, 400)) } }, signal, progress);
    const second = await this.translateWithRetry({ ...request, cues: request.cues.slice(half), batchContext: { before: [...before, ...contextBefore(first, byId)].slice(-4), after } }, signal, p => progress({ ...p, generatedCues: half + (p.generatedCues || 0) }));
    return [...first, ...second];
  }
  async translateTerms(request, terms, signal, progress) {
    const cues = terms.map((term, i) => ({ id: String(i), text: term }));
    try {
      const content = await this.generate(termsPrompt(request, terms), localGrammar(cues, {}, false), cues, signal, progress, { temperature: RETRY_TEMPERATURE });
      const translated = parseLocalTranslation(content, cues, { lenient: true });
      return Object.fromEntries(translated.map((s, i) => [terms[i], s.text]).filter(([from, to]) => to && to !== from));
    } catch (error) {
      signal?.throwIfAborted();
      return {}; // Names then rely on context alone; the episode can still be translated.
    }
  }
  async translateBatch(request, signal, progress = () => {}, { temperature, lenient = false } = {}) {
    const sounds = request.sounds || {}, wide = request.wide ?? isWideTarget(request.target), units = mergeUnits(request.cues);
    const content = await this.generate(localPrompt({ ...request, cues: units }), localGrammar(units, sounds, wide), units, signal, progress, { temperature });
    if (this.config.localEvaluationCapture) await this.config.localEvaluationCapture(content);
    return parseLocalTranslation(content, units, { terms: request.glossary || {}, sounds, wide, lenient });
  }
  async generate(prompt, grammar, cues, signal, progress, { temperature } = {}) {
    signal?.throwIfAborted();
    const report = (phase, outputChars = 0, generatedCues = 0) => progress({ phase, outputChars, generatedCues, totalCues: cues.length, lastActivity: Date.now(), provider: 'local' });
    report('local_loading');
    await this.start(); signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this.config.localTranslationTimeoutMs || 3600000);
    const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    report('local_reading');
    const tokenResponse = await this.fetcher(`${this.url}/tokenize`, { method: 'POST', headers: this.headers, body: JSON.stringify({ content: prompt }), signal: activeSignal });
    if (!tokenResponse.ok) throw new Error('The local model could not check the context length');
    const tokens = (await tokenResponse.json()).tokens?.length;
    const capacity = this.contextSize || this.config.localContextSize || 16384;
    const maxTokens = capacity - (tokens || capacity) - 256;
    // The alignment grammar emits the source as well as the translation. Counting only
    // the input lets long episodes start requests that cannot possibly finish.
    const scaffold = cues.map((cue, i) => `[${i + 1}] ${sourceText(cue)} => `).join('\n');
    const scaffoldResponse = await this.fetcher(`${this.url}/tokenize`, { method: 'POST', headers: this.headers, body: JSON.stringify({ content: scaffold }), signal: activeSignal });
    if (!scaffoldResponse.ok) throw new Error('The local model could not check the output capacity');
    const scaffoldTokens = (await scaffoldResponse.json()).tokens?.length;
    if (!Number.isInteger(scaffoldTokens) || maxTokens < scaffoldTokens + Math.max(1024, cues.length * 12)) throw Object.assign(new Error(`This batch exceeds the local model's context (${cues.length} subtitles); nothing was generated`), { capacity: true });
    // Aborting the streamed request makes llama-server stop generating; the process stays loaded.
    const response = await this.fetcher(`${this.url}/v1/chat/completions`, {
      method: 'POST', headers: this.headers, signal: activeSignal,
      body: JSON.stringify({ model: LOCAL_MODEL, messages: [{ role: 'user', content: prompt }], stream: true, temperature: temperature ?? this.config.localTemperature ?? 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05, max_tokens: Math.min(maxTokens, outputBudget(scaffoldTokens, cues)), grammar })
    });
    if (!response.ok) throw new Error(`The local model request failed (HTTP ${response.status}); see logs/local-model.log`);
    let content = '', pending = '', finishReason = null, generatedCues = 0;
    const decoder = new TextDecoder();
    const consume = line => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim(); if (!data || data === '[DONE]') return;
      const event = JSON.parse(data);
      if (event.error) throw new Error('The local model failed to generate');
      const choice = event.choices?.[0];
      const delta = choice?.delta?.content || '';
      content += delta;
      generatedCues += (delta.match(/\n/g) || []).length;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      report('local_receiving', content.length, Math.min(generatedCues, cues.length));
    };
    for await (const chunk of response.body) {
      activeSignal.throwIfAborted(); pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) consume(line);
    }
    pending += decoder.decode(); if (pending.trim()) consume(pending);
    activeSignal.throwIfAborted();
    if (finishReason !== 'stop') throw new Error('The local model output ended early; nothing was saved');
    report('validating', content.length, cues.length);
    return content;
  }
}
