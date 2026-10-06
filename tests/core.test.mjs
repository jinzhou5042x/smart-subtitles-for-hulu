import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.SubtitleCore;
test('subtitle bounds exclude player letterboxing and explicitly calibrated embedded bars', () => {
  const r = C.pictureRect({ left: 0, top: 0, width: 1600, height: 1200 }, 1920, 1080);
  assert.deepEqual(r, { left: 0, top: 150, width: 1600, height: 900 });
  const movie = C.pictureRect({ left: 0, top: 0, width: 1920, height: 1080 }, 1280, 720, 'contain', 2.39);
  assert.ok(Math.abs(movie.height - 1920 / 2.39) < 0.001);
  assert.ok(movie.top > 130);
});
test('Hulu infinite media duration falls back to the actual Timeline maximum', () => {
  assert.equal(C.mediaDuration(Infinity, '5948'), 5948);
  assert.equal(C.mediaDuration(6000, '5948'), 6000);
  assert.equal(C.mediaDuration(NaN, null), 0);
  assert.equal(C.mediaDuration(Infinity, 'Infinity'), 0);
});
test('TTML frame, subframe and offset timestamps preserve media time', () => {
  assert.equal(C.ttmlTime('00:01:02:15', 30), 62.5);
  assert.equal(C.ttmlTime('00:01:02.500'), 62.5);
  assert.equal(C.ttmlTime('1500ms'), 1.5);
  assert.equal(C.ttmlTime('60f', 30), 2);
  assert.equal(C.ttmlTime('200t', 30, 1, 100), 2);
  assert.ok(Number.isNaN(C.ttmlTime('not a time')));
});
test('SRT and VTT parsing preserves timing and strips markup', () => {
  const srt = '1\n00:00:01,200 --> 00:00:03,400\n<i>Hello</i> &amp; goodbye.\n\n2\n00:00:04,000 --> 00:00:06,000\nSee you.';
  const cues = C.parseSubtitles(srt);
  assert.equal(cues[0].text, 'Hello & goodbye.'); assert.equal(cues[0].start, 1.2); assert.equal(cues[1].end, 6);
  assert.equal(C.parseSubtitles('WEBVTT\n\nx\n00:01.200 --> 00:03.400 align:start\nHello')[0].start, 1.2);
  assert.throws(() => C.parseSubtitles('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000'));
});
test('playhead respects half-open intervals after forward/backward seeks', () => {
  const cues = [C.cue(0, 2, 'a'), C.cue(2, 4, 'b')];
  assert.equal(C.active(cues, 2)[0].text, 'b'); assert.equal(C.active(cues, 0)[0].text, 'a'); assert.deepEqual(C.active(cues, 4), []);
});
test('lookahead skips expired/cached cues and does not merge across scene gaps', () => {
  const cues = [C.cue(0, 2, 'old'), C.cue(3, 5, 'current'), C.cue(6, 8, 'next'), C.cue(30, 33, 'new scene')];
  const batch = C.batch(cues, 4, new Map([[cues[1].id, true]]), 60);
  assert.deepEqual(batch.map(c => c.text), ['next']);
});
test('the source subtitle language is decided by its text: English passes, Spanish does not', () => {
  const cues = lines => lines.map((text, i) => C.cue(i * 2, i * 2 + 1, text));
  const english = cues(["So you leave your couch for Ben and not for me, huh?", "I don't think I've ever introduced myself to you.", '[man coughing]', "What are you guys up to today?", "It's called a murder."]);
  const spanish = cues(['¿Así que dejas tu sofá por Ben y no por mí?', 'No creo que me haya presentado.', '[hombre tose]', '¿Qué van a hacer hoy?', 'Se llama un asesinato.']);
  assert.ok(C.englishShare(english) > 0.3); assert.equal(C.isEnglish(english), true);
  assert.ok(C.englishShare(spanish) < 0.05); assert.equal(C.isEnglish(spanish), false);
  assert.equal(C.isEnglish(cues(['♪ ♪', '[music]'])), false);
});
test('only subtitles clearly in another language are rejected; undecided text falls back to English', () => {
  const cues = lines => lines.map((text, i) => C.cue(i * 2, i * 2 + 1, text));
  assert.equal(C.sourceLanguage(cues(["So you leave your couch for Ben and not for me, huh?", "What are you guys up to today?"])), 'en');
  assert.equal(C.sourceLanguage(cues(['¿Así que dejas tu sofá por Ben y no por mí?', '¿Qué van a hacer hoy? Eso es muy raro.'])), 'other');
  assert.equal(C.sourceLanguage(cues(['Je ne sais pas ce que tu veux dire.', 'Il est très fatigué, mais nous sommes là.'])), 'other');
  assert.equal(C.sourceLanguage(cues(['我不知道你在说什么。', '他很累，但是我们在这里。'])), 'other');
  assert.equal(C.sourceLanguage(cues(['♪ Oh, oh, oh ♪', '[upbeat music]', 'Markie!', 'Pumpkin!'])), 'unknown');
});
