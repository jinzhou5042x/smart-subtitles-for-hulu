import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { root } from './config.mjs';
import { cacheKey, validateTranslation } from './translation.mjs';
import { SubtitleDatabase, episodeHash } from './database.mjs';

export const EPISODE_VERSION = 4;
const covered = segments => segments.reduce((n, segment) => n + segment.sourceIds.length, 0);

// Tracks whole-episode translations. Accepted translations of an unfinished episode are kept in
// memory under the episode hash (subtitles + target language) and the translator, independent of the
// page, tab or request: after a reload, a closed tab, a cancellation or an error (e.g. a usage
// limit), the next request for the same subtitles resumes after them. Nothing is written to disk
// until the whole episode has been translated and validated; then it is stored once under its hash.
export class EpisodeManager {
  constructor(queue, config, directory = path.join(root, 'data/episodes')) {
    this.database = new SubtitleDatabase(path.join(directory, 'subtitles.sqlite'), config);
    this.queue = queue; this.config = config; this.directory = directory; this.episodes = new Map(); this.progress = new Map(); this.loading = new Map(); this.cancelledRequests = new Map(); this.pendingRequests = new Set();
  }
  async submit(request) {
    this.pendingRequests.add(request);
    try {
    const id = cacheKey({ ...request, context: [{ text: `whole-episode-v${EPISODE_VERSION}` }] }, this.config);
    if (!this.episodes.has(id)) {
      if (!this.loading.has(id)) this.loading.set(id, this.load(id, request).finally(() => this.loading.delete(id)));
      await this.loading.get(id);
    }
    const episode = this.episodes.get(id);
    if (episode.cancelled && episode.task) await episode.task;
    // An earlier failed/cancelled in-memory request must see a result completed by another mode.
    if (!episode.running) {
      const cached = this.database.get(request);
      if (cached) { episode.segments = cached; episode.completedCues = request.cues.length; episode.status = 'done'; episode.cached = true; episode.error = ''; }
    }
    if (this.cancelledRequests.has(`${request.client}|${request.epoch}`)) return { ...this.public(episode, 0), status: 'cancelled' };
    episode.lastAccess = Date.now();
    episode.owners.set(request.client, request.epoch);
    if (episode.status !== 'done' && !episode.running) { episode.error = ''; episode.cancelled = false; episode.task = this.run(episode); }
    return this.public(episode, 0);
    } finally { this.pendingRequests.delete(request); }
  }
  async load(id, request) {
    if ([...this.episodes.values()].filter(e => e.running).length >= 4) throw new Error('Too many active episodes');
    await mkdir(this.directory, { recursive: true });
    const episode = { id, hash: episodeHash(request), request, segments: [], completedCues: 0, owners: new Map(), status: 'queued', running: false, cancelled: false, error: '', started: Date.now(), lastAccess: Date.now() };
    const cached = this.database.get(request);
    if (cached) { episode.segments = cached; episode.completedCues = request.cues.length; episode.status = 'done'; episode.cached = true; }
    this.episodes.set(id, episode);
    // Keep only a bounded number of inactive episode objects in RAM; complete results stay in SQLite.
    for (const [key, e] of this.episodes) if (this.episodes.size > 12 && key !== id && !e.running && e.owners.size === 0) this.episodes.delete(key);
  }
  // Accepted translations are stored by cue position, so they also apply when cue IDs change.
  progressKey(e) { return `${e.hash}|${e.request.provider || 'codex'}`; }
  recall(e) {
    const saved = this.progress.get(this.progressKey(e));
    if (!saved) return [];
    try {
      const segments = saved.map(s => ({ sourceIds: s.indices.map(i => e.request.cues[i]?.id), text: s.text }));
      return validateTranslation({ segments }, e.request.cues.slice(0, covered(segments)));
    } catch { this.progress.delete(this.progressKey(e)); return []; }
  }
  remember(e, segments) {
    const index = new Map(e.request.cues.map((c, i) => [c.id, i])), key = this.progressKey(e);
    this.progress.delete(key);
    this.progress.set(key, segments.map(s => ({ indices: s.sourceIds.map(id => index.get(id)), text: s.text })));
    while (this.progress.size > 50) this.progress.delete(this.progress.keys().next().value);
  }
  public(e, after = 0) {
    if (!e) return undefined;
    const start = Math.max(0, Math.min(e.segments.length, Number(after) || 0));
    const segments = e.segments.slice(start, start + 1000);
    const progress = e.progress;
    return { id: e.id, status: e.status, hash: e.hash, cached: !!e.cached, totalCues: e.request.cues.length, completedCues: e.completedCues, segments, cursor: start + segments.length, segmentCount: e.segments.length, error: e.error, progress, elapsedMs: (e.finished || Date.now()) - e.started };
  }
  get(id, after) { const e = this.episodes.get(id); if (e) e.lastAccess = Date.now(); return this.public(e, after); }
  cancel(client, epoch) {
    const now = Date.now();
    for (const [key, time] of this.cancelledRequests) if (now - time > 600000) this.cancelledRequests.delete(key);
    if (epoch !== undefined) this.cancelledRequests.set(`${client}|${epoch}`, now);
    for (const request of this.pendingRequests) if (request.client === client && (epoch === undefined || request.epoch === epoch)) this.cancelledRequests.set(`${client}|${request.epoch}`, now);
    for (const e of this.episodes.values()) {
      if (!e.owners.has(client) || (e.owners.get(client) !== epoch && epoch !== undefined)) continue;
      e.owners.delete(client);
      if (e.owners.size === 0 && e.running) { e.cancelled = true; this.queue.cancel(`episode-${e.id}`); }
    }
  }
  cancelTab(tabId) {
    const prefix = `tab-${tabId}-`;
    const clients = new Set([...this.pendingRequests].map(r => r.client));
    for (const e of this.episodes.values()) for (const client of e.owners.keys()) clients.add(client);
    for (const client of clients) if (client.startsWith(prefix)) this.cancel(client);
  }
  async run(e) {
    if (e.running) return;
    e.running = true; e.status = 'queued'; e.started = Date.now(); e.finished = null;
    let accepted = this.recall(e);
    e.segments = [...accepted]; e.completedCues = covered(accepted);
    // While a better provider replaces an existing complete result, keep showing that result.
    const preview = !accepted.length && this.database.get(e.request, { fallback: true });
    if (preview) e.segments = preview;
    try {
        let job = this.queue.submit({ ...e.request, accepted, client: `episode-${e.id}`, epoch: String(e.started), context: [{ text: 'Translate this entire episode in one response, using all dialogue as context.' }], wholeEpisode: true });
        while (['queued', 'running'].includes(job.status)) {
          e.status = job.status;
          if (job.progress) {
            const { partialSegments, ...progress } = job.progress;
            e.progress = progress;
            if (partialSegments?.length > accepted.length) {
              const count = covered(partialSegments);
              accepted = validateTranslation({ segments: partialSegments }, e.request.cues.slice(0, count));
              this.remember(e, accepted);
              if (!preview) { e.segments = accepted; e.completedCues = count; }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 200));
          if (e.cancelled) break;
          job = this.queue.get(job.id);
          if (!job) throw new Error('Episode task expired');
        }
        if (!e.cancelled) {
          if (job.status !== 'done') throw new Error(job.error || 'Episode translation cancelled');
          const complete = validateTranslation({ segments: job.segments }, e.request.cues);
          this.database.put(e.request, complete);
          e.segments = this.database.get(e.request) || complete;
          e.completedCues = e.request.cues.length; this.progress.delete(this.progressKey(e));
        }
      e.status = e.cancelled ? 'cancelled' : 'done';
    } catch (error) { e.status = 'error'; e.error = error.message; }
    finally { e.finished = Date.now(); e.running = false; }
  }
}
