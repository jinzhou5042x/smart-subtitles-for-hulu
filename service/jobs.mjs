import { randomUUID } from 'node:crypto';
import { cacheKey } from './translation.mjs';

// Runs whole-episode translations one at a time and lets them be cancelled.
// Complete results are stored by EpisodeManager in SQLite, not here.
export class JobQueue {
  constructor(translator, config) {
    this.translator = translator; this.config = config; this.jobs = new Map(); this.running = false;
  }
  submit(request) {
    this.prune();
    const waiting = [...this.jobs.values()].filter(j => ['queued', 'running'].includes(j.status));
    if (waiting.length >= 24) throw new Error('Translation queue is full');
    const key = cacheKey(request, this.config);
    const existing = waiting.find(j => j.key === key && j.request.client === request.client && j.request.epoch === request.epoch);
    if (existing) return this.public(existing);
    const job = { id: randomUUID(), key, request, status: 'queued', created: Date.now(), controller: new AbortController() };
    this.jobs.set(job.id, job); void this.drain(); return this.public(job);
  }
  public(j) { return j && { id: j.id, status: j.status, segments: j.segments, error: j.error, elapsedMs: j.elapsedMs, progress: j.progress }; }
  get(id) { return this.public(this.jobs.get(id)); }
  cancel(client, epoch) {
    for (const j of this.jobs.values()) if (j.request.client === client && (!epoch || j.request.epoch === epoch) && ['queued', 'running'].includes(j.status)) {
      j.status = 'cancelled'; j.controller.abort();
    }
  }
  prune() { for (const [id, j] of this.jobs) if (!['queued', 'running'].includes(j.status) && Date.now() - j.created > 600000) this.jobs.delete(id); }
  async drain() {
    if (this.running) return; this.running = true;
    try {
      for (;;) {
        const job = [...this.jobs.values()].find(j => j.status === 'queued'); if (!job) break;
        job.status = 'running'; const started = Date.now();
        try {
          const segments = await this.translator.translate(job.request, job.controller.signal, progress => { job.progress = progress; });
          if (job.controller.signal.aborted) continue;
          job.segments = segments; job.status = 'done'; job.elapsedMs = Date.now() - started;
        } catch (e) { if (job.status !== 'cancelled') { job.status = 'error'; job.error = e.message; } }
      }
    } finally { this.running = false; }
  }
}
