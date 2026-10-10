// Subtitle tracks: what was found for the title on screen and which one is used.
// No DOM and no service-specific knowledge; the player adapter only says how long the title is.
//
// A track is { name, language, detected, declared, cues, duration, timeOrigin, fingerprint }:
//   declared  the player's own data named this file as a subtitle track (playback metadata, a
//             manifest, a <track>), as opposed to a response that merely looked like subtitles
//   duration  the length of the track's complete playlist in seconds, 0 for a single file
//   detected  'en', 'other' or 'unknown', judged from the text (labels are often missing or wrong)
(function (scope) {
  const C = scope.SubtitleCore;
  const labeledEnglish = track => /^en(?:[-_]|$)/i.test(track.language || '');
  const xmlText = text => /^\s*(<\?xml|<(?:\w+:)?tt[\s>])/i.test(text);

  // Parses a captured file into a track. `parseXml` is the page's XML parser (TTML only).
  function parse(text, { name = '', language = '', duration = 0, timeOrigin = 0, declared = false } = {}, parseXml) {
    language = String(language || '').slice(0, 40);
    if (/^english$/i.test(language)) language = 'en';
    let cues;
    if (xmlText(text)) {
      const xml = parseXml(text);
      if (!xml || xml.querySelector('parsererror')) throw new Error('Invalid TTML');
      language ||= xml.documentElement.getAttribute('xml:lang') || '';
      cues = scope.SubtitleTTML.parseTTML(xml);
    } else cues = C.parseSubtitles(text);
    if (cues.length > 20000) throw new Error('Too many subtitle entries');
    return {
      name: String(name).slice(0, 150), language, detected: C.sourceLanguage(cues), declared: declared === true, cues, fingerprint: C.hash(text),
      duration: Number.isFinite(duration) && duration > 0 && duration < 86400 ? duration : 0,
      timeOrigin: Number.isFinite(timeOrigin) && Math.abs(timeOrigin) < 100000 ? timeOrigin : 0
    };
  }
  // A native text track of the <video>, read without touching its mode.
  function fromTextTrack(textTrack) {
    const cues = [...textTrack.cues].map(c => C.cue(c.startTime, c.endTime, c.text || '')).filter(c => c.text && c.end > c.start && c.end - c.start <= 120).sort((a, b) => a.start - b.start);
    return { name: 'text track', language: textTrack.language || '', detected: C.sourceLanguage(cues), declared: true, cues, duration: 0, timeOrigin: 0, fingerprint: C.hash(JSON.stringify(cues)) };
  }
  // Why each track is or is not usable; `titleSeconds(track)` comes from the player adapter.
  function assess(tracks, titleSeconds) {
    return tracks.map(track => {
      const seconds = Number(titleSeconds(track)) || 0;
      const reason = !track.cues.length ? 'empty' : track.detected === 'other' ? 'another language' : !seconds ? 'title length unknown' : !C.coversTitle(track.cues, seconds) ? 'does not cover the title' : '';
      return { track, seconds, usable: !reason, reason };
    });
  }
  // The title's English subtitles: among usable tracks, one the player declared, then English by
  // its text, then English by its label, then the one with most lines (usually SDH).
  function choose(tracks, titleSeconds) {
    const rank = t => [Number(t.declared), Number(t.detected === 'en'), Number(labeledEnglish(t)), t.cues.length];
    return assess(tracks, titleSeconds).filter(a => a.usable).map(a => a.track)
      .sort((a, b) => { const x = rank(a), y = rank(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || y[3] - x[3]; })[0] || null;
  }
  // The same judgement as a list for diagnostics.
  function describe(tracks, titleSeconds, selected) {
    return assess(tracks, titleSeconds).map(({ track, seconds, usable, reason }) => ({ name: track.name, language: track.language, detected: track.detected, declared: track.declared, lines: track.cues.length, ends: track.cues.at(-1)?.end, titleSeconds: seconds, usable, reason, selected: !!selected && selected.fingerprint === track.fingerprint }));
  }
  scope.SubtitleTracks = { parse, fromTextTrack, assess, choose, describe };
})(globalThis);
