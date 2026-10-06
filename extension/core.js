// Shared by the isolated content script and Node tests. No dependencies.
(function (scope) {
  const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  function clean(text) {
    return String(text).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[\t ]+/g, ' ').trim();
  }
  function cue(start, end, text) { text = clean(text); return { id: hash(`${start.toFixed(3)}|${end.toFixed(3)}|${text}`), start, end, text }; }
  function timestamp(s) { const p = s.replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
  function ttmlTime(value, frameRate = 30, subFrameRate = 1, tickRate = 1) {
    let m = String(value).trim().match(/^(\d{2,}):(\d{2}):(\d{2})(?:\.(\d+)|:(\d{2,})(?:\.(\d+))?)?$/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number('0.' + m[4]) : m[5] ? (Number(m[5]) + Number(m[6] || 0) / subFrameRate) / frameRate : 0);
    m = String(value).trim().match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/);
    return m ? Number(m[1]) * ({ h: 3600, m: 60, s: 1, ms: 0.001, f: 1 / frameRate, t: 1 / tickRate })[m[2]] : NaN;
  }
  function parseSubtitles(text) {
    if (text.length > 5_000_000) throw new Error('The subtitle file is larger than 5 MB');
    if (/X-TIMESTAMP-MAP/i.test(text)) throw new Error('Segmented subtitles carry their own clock; use the player subtitle track or a complete SRT/VTT file');
    const result = [];
    for (const block of text.replace(/\r/g, '').replace(/^\uFEFF/, '').split(/\n\s*\n/)) {
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block)) continue;
      const lines = block.split('\n');
      const i = lines.findIndex(l => l.includes('-->')); if (i < 0) continue;
      const m = lines[i].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/);
      if (!m) continue;
      const c = cue(timestamp(m[1]), timestamp(m[2]), lines.slice(i + 1).join('\n'));
      if (c.text && c.end > c.start && c.end - c.start <= 120) result.push(c);
    }
    if (!result.length) throw new Error('No valid SRT/VTT subtitles found');
    return [...new Map(result.map(c => [c.id, c])).values()].sort((a, b) => a.start - b.start);
  }
  function active(cues, time) { return cues.filter(c => c.start <= time && time < c.end); }
  function batch(cues, time, translated, lookAhead = 60, limit = 10) {
    const missing = cues.filter(c => c.end > time && c.start <= time + lookAhead && !translated.has(c.id));
    if (!missing.length) return [];
    const result = [];
    for (const c of missing) {
      if (result.length && c.start - result.at(-1).end > 5) break;
      result.push(c);
      if (result.length >= limit || (result.length >= 5 && /[.!?。！？]["'”’]?\s*$/.test(c.text))) break;
    }
    return result;
  }
  function mediaDuration(duration, timelineMax) {
    if (Number.isFinite(duration) && duration > 0) return duration;
    const fallback = Number(timelineMax);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }
  function pictureRect(rect, videoWidth, videoHeight, fit = 'contain', aspect = 0) {
    let { left, top, width, height } = rect;
    if (!(videoWidth > 0 && videoHeight > 0 && width > 0 && height > 0)) return { left, top, width, height };
    if (fit === 'contain' || fit === 'scale-down') {
      const scale = Math.min(width / videoWidth, height / videoHeight, fit === 'scale-down' ? 1 : Infinity);
      const w = videoWidth * scale, h = videoHeight * scale;
      left += (width - w) / 2; top += (height - h) / 2; width = w; height = h;
    }
    if (aspect > width / height && (fit === 'contain' || fit === 'scale-down')) {
      const h = width / aspect; top += (height - h) / 2; height = h;
    }
    return { left, top, width, height };
  }
  // Language labels in Hulu's metadata are missing or keyed in ways that are easy to miss, so the
  // source file is checked by its text. English dialogue is about a third common English function
  // words. A file is 'other' only when it is clearly another language: common words of a frequent
  // Hulu subtitle language, or mostly non-Latin letters. Anything undecided ('unknown', e.g. mostly
  // lyrics, names or sound effects) is treated as English. Bracketed labels are ignored.
  const words = list => new Set(list.split(' '));
  const ENGLISH_WORDS = words("the and you to is it that of what this with have are was your for not but just know can don't i'm it's we they she my do be all so get got there like right yeah okay hey gonna want would will he's that's i you're what's there's didn't can't won't let's");
  const OTHER_WORDS = [
    words('que de el la los las es por para con una pero está qué sí del muy cómo también eso esto estoy tengo'),
    words('je tu il elle est pas les des une que qui vous nous avec pour dans mais être fait suis très'),
    words('ich du er sie ist nicht das die der und ein eine mit auf für sind wir ihr was wie aber'),
    words('que não você eu ele ela uma com para mas está isso muito aqui então também tem'),
    words('che non sono il di una per con questo è ma cosa sei come anche ho ci')
  ];
  function analyse(cues) {
    let letters = 0, latin = 0, total = 0, english = 0;
    const other = OTHER_WORDS.map(() => 0);
    for (const c of cues.slice(0, 600)) {
      const text = c.text.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/’/g, "'");
      for (const ch of text) if (/\p{L}/u.test(ch)) { letters++; if (/\p{Script=Latin}/u.test(ch)) latin++; }
      for (const word of text.match(/[\p{L}']+/gu) || []) {
        total++; if (ENGLISH_WORDS.has(word)) english++;
        OTHER_WORDS.forEach((set, i) => { if (set.has(word)) other[i]++; });
      }
    }
    return { english: total ? english / total : 0, other: total ? Math.max(...other) / total : 0, nonLatin: letters ? 1 - latin / letters : 0 };
  }
  const englishShare = cues => analyse(cues).english;
  // 'en', 'other' (clearly another language) or 'unknown' (treated as English).
  function sourceLanguage(cues) {
    const { english, other, nonLatin } = analyse(cues);
    if (english >= 0.15 && english >= other) return 'en';
    if (other >= 0.15 || nonLatin > 0.5) return 'other';
    return 'unknown';
  }
  const isEnglish = cues => sourceLanguage(cues) === 'en';
  scope.SubtitleCore = { hash, clean, cue, timestamp, ttmlTime, parseSubtitles, active, batch, mediaDuration, pictureRect, englishShare, sourceLanguage, isEnglish };
})(globalThis);
