import { randomUUID } from 'node:crypto';
import { cacheKey } from './translation.mjs';

// Runs whole-episode translations, up to config.maxAgents (default 16) at once, each in its own
// Codex thread (e.g. several videos open in different tabs), and lets them be cancelled.
// Complete results are stored by EpisodeManager in SQLite, not here.
export class JobQueue {
  constructor(translator, config) {
    this.translator = translator; this.config = config; this.jobs = new Map(); this.running = 0;
    this.limit = Math.max(1, config.maxAgents || 16);
  }
  submit(request) {
    this.prune();
    const waiting = [...this.jobs.values()].filter(j => ['queued', 'running'].includes(j.status));
    if (waiting.length >= this.limit + 24) throw new Error('Translation queue is full');
    const key = cacheKey(request, this.config);
    const existing = waiting.find(j => j.key === key && j.request.client === request.client && j.request.epoch === request.epoch);
    if (existing) return this.public(existing);
    const job = { id: randomUUID(), key, request, status: 'queued', created: Date.now(), controller: new AbortController() };
    this.jobs.set(job.id, job); this.drain(); return this.public(job);
  }
  public(j) { return j && { id: j.id, status: j.status, segments: j.segments, error: j.error, elapsedMs: j.elapsedMs, progress: j.progress }; }
  get(id) { return this.public(this.jobs.get(id)); }
  cancel(client, epoch) {
    for (const j of this.jobs.values()) if (j.request.client === client && (!epoch || j.request.epoch === epoch) && ['queued', 'running'].includes(j.status)) {
      j.status = 'cancelled'; j.controller.abort();
    }
  }
  prune() { for (const [id, j] of this.jobs) if (!['queued', 'running'].includes(j.status) && Date.now() - j.created > 600000) this.jobs.delete(id); }
  drain() {
    while (this.running < this.limit) {
      const job = [...this.jobs.values()].find(j => j.status === 'queued'); if (!job) return;
      void this.run(job);
    }
  }
  async run(job) {
    this.running++; job.status = 'running'; const started = Date.now();
    try {
      const segments = await this.translator.translate(job.request, job.controller.signal, progress => { job.progress = progress; });
      if (job.controller.signal.aborted) return;
      job.segments = segments; job.status = 'done'; job.elapsedMs = Date.now() - started;
    } catch (e) { if (job.status !== 'cancelled') { job.status = 'error'; job.error = e.message; } }
    finally { this.running--; this.drain(); }
  }
}
