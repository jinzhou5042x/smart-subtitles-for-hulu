import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { validateTranslation } from './translation.mjs';

// Prefer a Codex translation when more than one provider has a result.
export const providerRank = provider => provider === 'codex' || !provider ? 2 : 1;
export function subtitleHash(cues) {
  return createHash('sha256').update(JSON.stringify(cues.map(c => [c.start, c.end, c.text.normalize('NFC').replace(/\s+/g, ' ').trim()]))).digest('hex');
}
// Tokens a translator used (Codex): input (including cached input), cached input, output (including reasoning) and reasoning.
export const USAGE = { input: 'input_tokens', cachedInput: 'cached_input_tokens', output: 'output_tokens', reasoning: 'reasoning_output_tokens' };
export const addUsage = (a, b) => (a || b) && Object.fromEntries(Object.keys(USAGE).map(k => [k, (a?.[k] || 0) + (b?.[k] || 0)]));
const usageOf = row => row && Object.values(USAGE).some(c => row[c]) ? Object.fromEntries(Object.entries(USAGE).map(([k, c]) => [k, row[c]])) : null;
const USAGE_COLUMNS = Object.values(USAGE).join(', ');

// Identifies an episode translation in memory: the normalized subtitles (timing and text) and the target language.
export const episodeHash = request => createHash('sha256').update(JSON.stringify([subtitleHash(request.cues), request.target])).digest('hex');

// The local translation database (data/episodes/subtitles.sqlite):
// - sources: one row per subtitle file, keyed by subtitleHash; its cues map an idx to timestamps.
// - translations: per source, target language and provider, how many cues (`done`, a prefix
//   from idx 0) are translated, whether the translation is complete, and the tokens it used so far.
// - lines: the translated text by the idx of its first cue; `span` is 2 when a translator merged
//   two cues into one line (local mode), otherwise 1.
// Production writes complete windows of independently bound cues; old lines remain archived.
export class SubtitleDatabase {
  constructor(file, config) { this.file = file; this.config = config; }
  open() {
    const db = new DatabaseSync(this.file);
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sources(hash TEXT PRIMARY KEY, cues TEXT NOT NULL, cue_count INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS translations(hash TEXT NOT NULL, target TEXT NOT NULL, provider TEXT NOT NULL, done INTEGER NOT NULL, complete INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(hash, target, provider));
      CREATE TABLE IF NOT EXISTS lines(hash TEXT NOT NULL, target TEXT NOT NULL, provider TEXT NOT NULL, idx INTEGER NOT NULL, span INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(hash, target, provider, idx));`);
    const columns = new Set(db.prepare('PRAGMA table_info(translations)').all().map(c => c.name));
    for (const column of Object.values(USAGE)) if (!columns.has(column)) db.exec(`ALTER TABLE translations ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    if (!columns.has('binding_version')) db.exec('ALTER TABLE translations ADD COLUMN binding_version INTEGER NOT NULL DEFAULT 0');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='episodes'").get()) this.migrate(db);
    if (this.config.requireBinding) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_drafts'").get() && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_translations'").get()) db.exec('ALTER TABLE review_drafts RENAME TO legacy_translations');
      db.exec('CREATE TABLE IF NOT EXISTS legacy_translations(hash TEXT, target TEXT, provider TEXT, lines TEXT NOT NULL, PRIMARY KEY(hash,target,provider)); BEGIN IMMEDIATE');
      try {
        for (const row of db.prepare('SELECT hash,target,provider FROM translations WHERE binding_version=0').all()) {
          const args = [row.hash, row.target, row.provider];
          const lines = db.prepare('SELECT idx,span,text FROM lines WHERE hash=? AND target=? AND provider=? ORDER BY idx').all(...args);
          db.prepare('INSERT OR IGNORE INTO legacy_translations VALUES(?,?,?,?)').run(...args, JSON.stringify(lines));
          this.forget(db, ...args);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
    }
    return db;
  }
  // Moves complete episodes of 0.9.0 (one row per subtitles + target) into the shared tables.
  migrate(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of db.prepare('SELECT target, provider, cues, segments, created_at FROM episodes').all()) {
        const cues = JSON.parse(row.cues), hash = subtitleHash(cues);
        db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?)').run(hash, row.cues, cues.length, row.created_at);
        db.prepare('INSERT OR IGNORE INTO translations(hash, target, provider, done, complete, updated_at) VALUES(?,?,?,?,1,?)').run(hash, row.target, row.provider, cues.length, row.created_at);
        for (const s of JSON.parse(row.segments)) db.prepare('INSERT OR IGNORE INTO lines VALUES(?,?,?,?,?,?)').run(hash, row.target, row.provider, s.indices[0], s.indices.length, s.text);
      }
      db.exec('DROP TABLE episodes; COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  with(fn) { const db = this.open(); try { return fn(db); } finally { db.close(); } }
  // Lines of a stored translation, as segments with the request's cue IDs.
  read(db, hash, request, provider, count) {
    const rows = db.prepare('SELECT idx, span, text FROM lines WHERE hash=? AND target=? AND provider=? AND idx<? ORDER BY idx').all(hash, request.target, provider, count);
    const segments = rows.map(r => ({ sourceIds: Array.from({ length: r.span }, (_, k) => request.cues[r.idx + k]?.id), text: r.text }));
    return validateTranslation({ segments }, request.cues.slice(0, count));
  }
  // The complete translation that `get` returns: the highest-ranked one, and among equals the first completed.
  best(db, hash, target) {
    const rows = db.prepare(`SELECT provider, ${USAGE_COLUMNS} FROM translations WHERE hash=? AND target=? AND complete=1 ORDER BY updated_at`).all(hash, target);
    return rows.sort((a, b) => providerRank(b.provider) - providerRank(a.provider))[0];
  }
  // Returns a complete translation when it is at least as good as the requested provider.
  // `fallback` also accepts a lower-ranked one.
  get(request, { fallback = false } = {}) {
    const hash = subtitleHash(request.cues);
    return this.with(db => {
      const best = this.best(db, hash, request.target);
      if (!best || (!fallback && providerRank(best.provider) < providerRank(request.provider))) return null;
      try { return this.read(db, hash, request, best.provider, request.cues.length); }
      catch { this.forget(db, hash, request.target, best.provider); return null; }
    });
  }
  // The accepted prefix of an unfinished translation by the requested provider.
  partial(request) {
    const hash = subtitleHash(request.cues), provider = request.provider || 'codex';
    return this.with(db => {
      const row = db.prepare('SELECT done FROM translations WHERE hash=? AND target=? AND provider=? AND complete=0').get(hash, request.target, provider);
      if (!row?.done) return [];
      try { return this.read(db, hash, request, provider, row.done); }
      catch { this.forget(db, hash, request.target, provider); return []; }
    });
  }
  // Tokens used by the complete translation that `get` returns, or (`partial`) by the requested
  // provider's unfinished one; null when none were recorded.
  usage(request, { partial = false } = {}) {
    const hash = subtitleHash(request.cues);
    return this.with(db => usageOf(partial
      ? db.prepare(`SELECT ${USAGE_COLUMNS} FROM translations WHERE hash=? AND target=? AND provider=? AND complete=0`).get(hash, request.target, request.provider || 'codex')
      : this.best(db, hash, request.target)));
  }
  forget(db, hash, target, provider) {
    db.prepare('DELETE FROM lines WHERE hash=? AND target=? AND provider=?').run(hash, target, provider);
    db.prepare('DELETE FROM translations WHERE hash=? AND target=? AND provider=?').run(hash, target, provider);
  }
  // Stores the accepted prefix `segments` (validated against the first cues, possibly none) and the
  // tokens used so far. A complete translation is kept: the first complete result of a provider is never overwritten.
  save(request, segments, { complete = false, usage } = {}) {
    const count = segments.reduce((n, s) => n + s.sourceIds.length, 0);
    const cues = request.cues.slice(0, count);
    const validated = count ? validateTranslation({ segments }, cues) : [];
    if (complete && count !== request.cues.length) throw new Error('Incomplete translation');
    const index = new Map(request.cues.map((c, i) => [c.id, i]));
    const hash = subtitleHash(request.cues), provider = request.provider || 'codex', now = new Date().toISOString();
    this.with(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare(`SELECT done, complete, ${USAGE_COLUMNS} FROM translations WHERE hash=? AND target=? AND provider=?`).get(hash, request.target, provider);
        if (existing?.complete) return db.exec('COMMIT');
        const tokens = Object.entries(USAGE).map(([k, c]) => usage ? usage[k] || 0 : existing?.[c] || 0);
        if (!complete && existing && existing.done >= count) {
          if (usage) db.prepare(`UPDATE translations SET ${Object.values(USAGE).map(c => `${c}=?`).join(', ')}, updated_at=? WHERE hash=? AND target=? AND provider=?`).run(...tokens, now, hash, request.target, provider);
          return db.exec('COMMIT');
        }
        db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?)').run(hash, JSON.stringify(request.cues.map(({ start, end, text }) => ({ start, end, text }))), request.cues.length, now);
        // A growing prefix only appends its new lines; a complete result (whose final text may differ
        // from the streamed lines) or a prefix that does not continue at `done` replaces them all.
        const from = existing?.done || 0;
        const lines = validated.map(s => ({ idx: index.get(s.sourceIds[0]), span: s.sourceIds.length, text: s.text }));
        const append = !complete && from > 0 && !lines.some(l => l.idx < from && l.idx + l.span > from);
        if (!append) db.prepare('DELETE FROM lines WHERE hash=? AND target=? AND provider=?').run(hash, request.target, provider);
        const line = db.prepare('INSERT OR REPLACE INTO lines VALUES(?,?,?,?,?,?)');
        for (const l of lines) if (!append || l.idx >= from) line.run(hash, request.target, provider, l.idx, l.span, l.text);
        db.prepare(`INSERT OR REPLACE INTO translations(hash, target, provider, done, complete, updated_at, ${USAGE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(hash, request.target, provider, count, complete ? 1 : 0, now, ...tokens);
        if (this.config.requireBinding) db.prepare('UPDATE translations SET binding_version=1 WHERE hash=? AND target=? AND provider=?').run(hash, request.target, provider);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    });
  }
  put(request, segments, usage) { this.save(request, segments, { complete: true, usage }); }
}
