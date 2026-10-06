import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { root } from './config.mjs';
import { instructions, outputSchema, buildPrompt, alignByIndex, segmentStream, validateTranslation } from './translation.mjs';

// codexPath is an executable ("codex", a codex.exe path) or [node.exe, codex.js] for the copy that
// "Set Up Codex.cmd" installs; relative paths are resolved against the app folder. Never via a shell.
export function codexCommand(config) {
  const parts = (Array.isArray(config.codexPath) ? config.codexPath : [config.codexPath || 'codex']).map(p => /[\\/]/.test(p) && !path.isAbsolute(p) ? path.join(root, p) : p);
  return { command: parts[0], prefix: parts.slice(1) };
}

// A long-lived official app-server process; no shell command interpolation.
export class CodexTranslator extends EventEmitter {
  constructor(config) { super(); this.config = config; this.pending = new Map(); this.nextId = 0; this.ready = null; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.initialize().catch(e => { this.close(); throw e; });
    return this.ready;
  }
  async initialize() {
    const disabled = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'multi_agent_v2', 'computer_use', 'browser_use', 'browser_use_external', 'in_app_browser', 'image_generation', 'view_image', 'memories', 'skill_search', 'code_mode', 'code_mode_host'];
    const args = ['app-server', '--listen', 'stdio://', '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '-c', 'project_doc_max_bytes=0', '-c', 'approval_policy="never"'];
    for (const f of disabled) args.push('-c', `features.${f}=false`);
    const { command, prefix } = codexCommand(this.config);
    this.child = spawn(command, [...prefix, ...args], { cwd: path.join(root, 'data/worker'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const processHandle = this.child;
    this.child.on('error', e => { if (this.child === processHandle) this.fail(e); });
    this.child.on('exit', (code) => { if (this.child !== processHandle) return; this.fail(new Error(`Codex exited (${code})`)); this.ready = null; this.child = null; });
    // Never log raw Codex events or stderr: these can contain user data.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => {});
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && m.method) {
        // No dynamic tools, approvals, or interactive actions are implemented.
        this.send({ id: m.id, error: { code: -32601, message: 'Subtitle translator has no tools or interactive approvals' } });
      } else if (m.id !== undefined) {
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id); clearTimeout(p.timer);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else this.emit('notification', m);
    });
    await this.rpc('initialize', { clientInfo: { name: 'hulu_context_subtitles', version: '0.1.0', title: 'Hulu Context Subtitles' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  send(message) { this.child?.stdin.write(JSON.stringify(message) + '\n'); }
  rpc(method, params, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); this.emit('failure', error); }
  close() { const child = this.child; this.child = null; this.ready = null; this.fail(new Error('Codex stopped')); child?.kill(); }
  // Translates a whole episode. Translations that have been accepted (streamed in sequence and
  // validated) are never sent again: an attempt that fails after progress is continued from the
  // first missing subtitle, and request.accepted lets a later retry resume the same way.
  async translate(request, signal, onProgress = () => {}) {
    const accepted = [...(request.accepted || [])];
    const done = () => accepted.reduce((n, s) => n + s.sourceIds.length, 0);
    let progress = { phase: 'connecting', outputChars: 0, lastActivity: Date.now() };
    const report = changes => { progress = { ...progress, ...changes, lastActivity: Date.now() }; onProgress(progress); };
    report(accepted.length ? { partialSegments: [...accepted], completedCues: done(), totalCues: request.cues.length } : {});
    let lastError;
    while (done() < request.cues.length) {
      const before = done();
      try { await this.translateRest(request, accepted, signal, report); }
      catch (error) {
        signal?.throwIfAborted(); lastError = error;
        if (done() === before) throw error;
        report({ phase: 'retrying' });
      }
    }
    return validateTranslation({ segments: accepted }, request.cues);
  }
  async translateRest(request, accepted, signal, report) {
    const offset = accepted.reduce((n, s) => n + s.sourceIds.length, 0), rest = request.cues.slice(offset);
    const byId = new Map(request.cues.map(c => [c.id, c]));
    // Already accepted lines give the continuation its context; they are not translated again.
    const previous = accepted.slice(-30).map(s => ({ text: s.sourceIds.map(id => byId.get(id).text).join(' '), translation: s.text }));
    const part = { ...request, cues: rest, context: offset ? [...(request.context || []), ...previous] : request.context };
    signal?.throwIfAborted(); await this.start(); signal?.throwIfAborted();
    const params = { cwd: path.join(root, 'data/worker'), ephemeral: true, environments: [], selectedCapabilityRoots: [], dynamicTools: [], sandbox: 'read-only', approvalPolicy: 'never', baseInstructions: instructions, developerInstructions: 'Only translate the provided JSON. No tools, commands, external knowledge lookup or filesystem access.', config: { 'model_reasoning_effort': this.config.effort } };
    if (this.config.model) params.model = this.config.model;
    const response = await this.rpc('thread/start', params), { thread } = response;
    this.lastModel = response.model;
    report({ phase: 'submitted', model: response.model });
    let turnId, text = '', streamed = 0, streaming = true, outputChars = 0;
    const feed = segmentStream();
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); this.off('notification', onMessage); this.off('failure', onFailure); signal?.removeEventListener('abort', abort);
          error ? reject(error) : resolve(value);
        };
        const interrupt = () => { if (turnId) this.rpc('turn/interrupt', { threadId: thread.id, turnId }).catch(() => {}); };
        const abort = () => { interrupt(); finish(new Error('Translation cancelled')); };
        const onFailure = e => finish(e);
        const onMessage = m => {
          if (m.params?.threadId !== thread.id) return;
          if (m.method === 'error') {
            if (!m.params.willRetry) return finish(new Error(m.params.error?.message || 'Codex request failed'));
            report({ phase: 'retrying' });
          }
          if (m.method === 'item/agentMessage/delta') {
            text += m.params.delta; outputChars += m.params.delta.length;
            // Show each translation as soon as its number continues the sequence; it takes the
            // source cue's timestamps and is accepted. The complete output is validated again.
            for (const segment of streaming ? feed(m.params.delta) : []) {
              const cue = rest[streamed];
              try {
                if (segment?.i !== streamed + 1 || !cue) throw new Error('out of sequence');
                accepted.push(...validateTranslation({ segments: [{ sourceIds: [cue.id], text: segment.t }] }, [cue])); streamed++;
              } catch { streaming = false; break; }
            }
            report({ phase: 'receiving', outputChars, ...(accepted.length ? { partialSegments: [...accepted], completedCues: offset + streamed, totalCues: request.cues.length } : {}) });
          }
          if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') text = m.params.item.text;
          if (m.method === 'turn/completed') {
            if (m.params.turn.status !== 'completed') return finish(new Error(m.params.turn.error?.message || 'Codex translation failed'));
            report({ phase: 'validating' });
            try {
              const aligned = alignByIndex(JSON.parse(text).segments, rest);
              accepted.splice(accepted.length - streamed, streamed, ...aligned);
              finish(null);
            } catch (e) { finish(e); }
          }
        };
        const timer = setTimeout(() => { interrupt(); finish(new Error('Episode translation timed out; please retry')); }, this.config.episodeTranslationTimeoutMs || 1800000);
        this.on('notification', onMessage); this.on('failure', onFailure); signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        this.rpc('turn/start', { threadId: thread.id, environments: [], input: [{ type: 'text', text: buildPrompt(part, this.config.glossary) }], effort: this.config.effort, outputSchema }).then(r => { turnId = r.turn.id; if (settled) interrupt(); }).catch(e => finish(e));
      });
    } finally { await this.rpc('thread/unsubscribe', { threadId: thread.id }, 3000).catch(() => {}); }
  }
}
