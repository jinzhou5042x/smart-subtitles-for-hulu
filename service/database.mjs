import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { validateTranslation } from './translation.mjs';

// Codex reads the whole episode at once; its result may replace a batch/sentence-level one.
export const providerRank = provider => provider === 'codex' || !provider ? 2 : 1;
export function subtitleHash(cues) {
  return createHash('sha256').update(JSON.stringify(cues.map(c => [c.start, c.end, c.text.normalize('NFC').replace(/\s+/g, ' ').trim()]))).digest('hex');
}
// Unique key of a stored episode: the normalized subtitles (timing and text) and the target language.
export const episodeHash = request => createHash('sha256').update(JSON.stringify([subtitleHash(request.cues), request.target])).digest('hex');

// One row per completed episode: the source subtitles and their translation, written in a single
// statement only after the whole episode has been translated and validated.
export class SubtitleDatabase {
  constructor(file, config) { this.file = file; this.config = config; }
  open() {
    const db = new DatabaseSync(this.file);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS episodes(hash TEXT PRIMARY KEY, target TEXT NOT NULL, provider TEXT NOT NULL, cues TEXT NOT NULL, segments TEXT NOT NULL, created_at TEXT NOT NULL);`);
    return db;
  }
  // Returns the stored translation when it is at least as good as the requested provider.
  // `fallback` also accepts a lower-ranked one, shown while a better one is produced.
  get(request, { fallback = false } = {}) {
    const db = this.open(), hash = episodeHash(request);
    try {
      const row = db.prepare('SELECT provider, segments FROM episodes WHERE hash=?').get(hash);
      if (!row || (!fallback && providerRank(row.provider) < providerRank(request.provider))) return null;
      try {
        const segments = JSON.parse(row.segments).map(s => ({ sourceIds: s.indices.map(i => request.cues[i]?.id), text: s.text }));
        return validateTranslation({ segments }, request.cues);
      } catch { db.prepare('DELETE FROM episodes WHERE hash=?').run(hash); return null; }
    } finally { db.close(); }
  }
  // Stores a complete, validated episode. The first result is kept unless a higher-ranked provider
  // completes later.
  put(request, segments) {
    const validated = validateTranslation({ segments }, request.cues);
    const index = new Map(request.cues.map((c, i) => [c.id, i]));
    const stored = validated.map(s => ({ indices: s.sourceIds.map(id => index.get(id)), text: s.text }));
    const cues = request.cues.map(({ start, end, text }) => ({ start, end, text }));
    const provider = request.provider || 'codex', hash = episodeHash(request), db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      const existing = db.prepare('SELECT provider FROM episodes WHERE hash=?').get(hash);
      if (!existing || providerRank(provider) > providerRank(existing.provider)) db.prepare('INSERT OR REPLACE INTO episodes VALUES(?,?,?,?,?,?)').run(hash, request.target, provider, JSON.stringify(cues), JSON.stringify(stored), new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.close(); }
  }
}
