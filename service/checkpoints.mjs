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
  // Every one-minute window that passed validation is already saved, so a failure only ever
  // costs the window being written. What the model wrote wrongly (a source not copied exactly, a
  // slot left out) is repaired without the viewer:
  //   1. ask again for the rest of the episode, from the last saved window;
  //   2. if the same window fails twice in a row, translate that window alone, a request a
  //      hundredth the size whose conditions differ, then go back to the whole episode;
  //   3. only when the window alone has failed four times is the problem reported.
  // Anything that is not the model's writing (no sign-in, a usage limit, a lost connection) is
  // not handled here: the caller decides whether it needs the viewer.
  let result, failures = 0, alone = 0;
  for (;;) {
    const before = saved.length;
    try {
      if (failures >= 2 && translator.translateEpisode) {
        const end = windowEnd(request.cues, saved.length);
        progress({ phase: 'retrying', partialSegments: [...saved], completedCues: saved.length, totalCues: request.cues.length, usage, lastActivity: Date.now() });
        const part = await translator.translateEpisode({ ...request, cues: request.cues.slice(saved.length, end), accepted: [] }, signal, () => {});
        signal?.throwIfAborted();
        receive({ partialSegments: [...saved, ...part] }, end === request.cues.length);
        if (saved.length < end) throw Object.assign(new Error('The repaired subtitles could not be saved'), { modelOutput: true });
        failures = 0; alone = 0;
        if (saved.length === request.cues.length) { result = saved; break; }
        continue;
      }
      const attempt = { ...request, accepted: saved };
      result = translator.translateEpisode ? await translator.translateEpisode(attempt, signal, receive) : await translator.translate(attempt, signal, receive);
      break;
    } catch (error) {
      signal?.throwIfAborted();
      if (!error.modelOutput) throw error;
      if (saved.length > before) { failures = 1; alone = 0; }
      else if (failures >= 2) alone++;
      else failures++;
      if (alone >= 4 || (failures >= 2 && !translator.translateEpisode)) throw Object.assign(error, { needsUser: true });
      progress({ phase: 'retrying', partialSegments: [...saved], completedCues: saved.length, totalCues: request.cues.length, usage, lastActivity: Date.now() });
    }
  }
  signal?.throwIfAborted();
  receive({ partialSegments: result }, true);
  return validateTranslation({ segments: result }, request.cues);
}
