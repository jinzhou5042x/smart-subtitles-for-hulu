import { validateTranslation } from './translation.mjs';
export function windowEnd(cues, offset) {
  const boundary = (Math.floor(cues[offset].start / 60) + 1) * 60;
  let end = offset + 1;
  while (end < cues.length && cues[end].start < boundary) end++;
  return end;
}
// Checkpoints consume a single output stream; they never start model requests.
export async function translateCheckpoints(request, translator, signal, progress = () => {}, checkpoint = () => {}) {
  let saved = [...(request.accepted || [])], usage = null;
  let next = saved.length < request.cues.length ? windowEnd(request.cues, saved.length) : Infinity;
  const receive = (p, complete = false) => {
    if (p.usage) usage = p.usage;
    const candidate = p.partialSegments;
    while (candidate && candidate.length >= next && (next < request.cues.length || complete)) {
      signal?.throwIfAborted();
      const prefix = validateTranslation({ segments: candidate.slice(0, next) }, request.cues.slice(0, next));
      const persisted = checkpoint(prefix, usage); // Synchronous SQLite commit and read-back, before publication.
      saved = Array.isArray(persisted) ? validateTranslation({ segments: persisted.slice(0, next) }, request.cues.slice(0, next)) : prefix;
      next = next < request.cues.length ? windowEnd(request.cues, next) : Infinity;
    }
    progress({ phase: 'receiving', partialSegments: [...saved], completedCues: saved.length, totalCues: request.cues.length, usage, lastActivity: Date.now() });
  };
  if (saved.length === request.cues.length) return validateTranslation({ segments: saved }, request.cues);
  const result = translator.translateEpisode
    ? await translator.translateEpisode(request, signal, receive)
    : await translator.translate(request, signal, receive);
  signal?.throwIfAborted();
  receive({ partialSegments: result }, true);
  return validateTranslation({ segments: result }, request.cues);
}
