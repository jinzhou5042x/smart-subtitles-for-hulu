import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
import '../extension/tracks.js';
const T = globalThis.SubtitleTracks;
const english = n => Array.from({ length: n }, (_, i) => `${i + 1}\n${stamp(i * 3)} --> ${stamp(i * 3 + 2)}\nWhat do you think about that, and what are we going to do?`).join('\n\n');
const stamp = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`;
const lines = (count, end) => Array.from({ length: count }, (_, i) => ({ id: 'c' + i, start: end * i / count, end: end * (i + 1) / count, text: 'x' }));
const track = (name, cues, extra = {}) => ({ name, language: '', detected: 'en', declared: false, cues, duration: 0, timeOrigin: 0, fingerprint: name, ...extra });

test('a captured file becomes a track with its language, origin and declaration', () => {
  const parsed = T.parse('WEBVTT\n\n' + english(40), { name: 'a.vtt', language: 'English', duration: 130, timeOrigin: 10, declared: true });
  assert.equal(parsed.cues.length, 40); assert.equal(parsed.language, 'en'); assert.equal(parsed.detected, 'en');
  assert.equal(parsed.declared, true); assert.equal(parsed.duration, 130); assert.equal(parsed.timeOrigin, 10);
  const loose = T.parse('WEBVTT\n\n' + english(3), { name: 'seg.vtt', duration: -5, timeOrigin: 1e9, declared: 'yes' });
  assert.equal(loose.declared, false, 'only an explicit true is a declaration'); assert.equal(loose.duration, 0); assert.equal(loose.timeOrigin, 0);
  assert.notEqual(parsed.fingerprint, loose.fingerprint);
  assert.throws(() => T.parse('not subtitles'), /No valid/);
});

// The page of 2026-10-10: a 50-minute Disney+ episode with the complete English playlist and
// four loose segments of another track the player had loaded for itself.
test('the title\'s track is the one that covers it; loose segments and other languages never are', () => {
  const playlist = track('composite_en_SDH.m3u8', lines(884, 2986.358), { language: 'en', declared: true, duration: 3000 });
  const page = [playlist, track('pts_0.vtt', lines(2, 132.924)), track('pts_354521.vtt', lines(4, 516.975)), track('pts_728186.vtt', lines(3, 807.265)), track('pts_1185059.vtt', lines(8, 1534.575))];
  const disney = t => t.duration || 0;
  assert.equal(T.choose(page, disney), playlist);
  assert.equal(T.choose(page.slice(1), disney), null, 'without the playlist nothing is chosen, rather than a segment');
  // The same files judged by an element duration of 133.3 s, as the old code did, pick the 2-line segment.
  assert.equal(T.choose(page, () => 133.304055).name, 'pts_0.vtt');
  const why = Object.fromEntries(T.describe(page, disney, playlist).map(d => [d.name, d]));
  assert.equal(why['composite_en_SDH.m3u8'].selected, true); assert.equal(why['composite_en_SDH.m3u8'].usable, true);
  assert.equal(why['pts_0.vtt'].reason, 'title length unknown');
  const spanish = track('es.vtt', lines(900, 2990), { detected: 'other', declared: true, duration: 3000 });
  assert.equal(T.choose([spanish], disney), null); assert.equal(T.describe([spanish], disney)[0].reason, 'another language');
});

test('among complete tracks: declared by the player first, then English by text, by label, then the fullest', () => {
  const seconds = () => 1800, full = n => lines(n, 1790);
  const observed = track('observed', full(700)), declared = track('declared', full(500), { declared: true });
  assert.equal(T.choose([observed, declared], seconds), declared);
  const unknown = track('unknown', full(900), { detected: 'unknown', declared: true });
  assert.equal(T.choose([unknown, declared], seconds), declared);
  const labeled = track('labeled', full(400), { detected: 'unknown', language: 'en-US' }), bare = track('bare', full(600), { detected: 'unknown' });
  assert.equal(T.choose([bare, labeled], seconds), labeled);
  const sdh = track('sdh', full(650)), plain = track('plain', full(600));
  assert.equal(T.choose([plain, sdh], seconds), sdh);
  assert.equal(T.choose([track('short', lines(100, 600))], seconds), null);
});

test('a native text track is read as a declared track without changing it', () => {
  const textTrack = { language: 'en', cues: [{ startTime: 4, endTime: 6, text: 'Second.' }, { startTime: 1, endTime: 3, text: '<i>First</i>' }, { startTime: 7, endTime: 7, text: 'Empty' }] };
  const read = T.fromTextTrack(textTrack);
  assert.deepEqual(read.cues.map(c => c.text), ['First', 'Second.']); assert.equal(read.declared, true); assert.equal(textTrack.mode, undefined);
});
