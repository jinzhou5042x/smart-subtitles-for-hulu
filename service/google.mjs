import { readFile } from 'node:fs/promises';
import { validateTranslation } from './translation.mjs';

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity[0] === '#') { const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()] || match;
  });
}
export class GoogleTranslator {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  async translate(request, signal, progress = () => {}) {
    signal?.throwIfAborted();
    let key;
    if (this.config.googleApiKeyFile === null) throw new Error('Link your Google API key file in the extension');
    if (this.config.googleApiKeyFile) {
      try { key = (await readFile(this.config.googleApiKeyFile, 'utf8')).trim(); }
      catch { throw new Error('Cannot read googleApiKeyFile; check your chosen key file'); }
    } else key = this.config.googleApiKey || process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!key) throw new Error('Set googleApiKeyFile in config/local.json to your key file path and restart the subtitle service');
    const target = request.target; // Language codes are Google Cloud Translation codes.
    const segments = [...(request.accepted || [])];
    const acceptedCount = segments.reduce((n, s) => n + s.sourceIds.length, 0);
    // Google v2 accepts at most 128 strings. Keep requests below 5,000 code points.
    for (let start = acceptedCount; start < request.cues.length;) {
      signal?.throwIfAborted();
      let end = start, characters = 0;
      while (end < request.cues.length && end - start < 128) {
        const size = [...request.cues[end].text].length;
        if (end > start && characters + size > 5000) break;
        characters += size; end++;
      }
      const cues = request.cues.slice(start, end);
      const response = await this.fetcher('https://translation.googleapis.com/language/translate/v2', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
        body: JSON.stringify({ q: cues.map(c => c.text), source: 'en', target, format: 'text' }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)
      });
      signal?.throwIfAborted();
      if (!response.ok) throw new Error(`Google Translate request failed (HTTP ${response.status}); check the API key, that the API is enabled, and the quota`);
      const data = await response.json(), translations = data.data?.translations;
      if (!Array.isArray(translations) || translations.length !== cues.length || translations.some(t => typeof t.translatedText !== 'string')) throw new Error('Google returned an incomplete or malformed result');
      segments.push(...translations.map((t, i) => ({ sourceIds: [cues[i].id], text: decode(t.translatedText) })));
      validateTranslation({ segments }, request.cues.slice(0, end));
      progress({ partialSegments: [...segments] });
      start = end;
    }
    signal?.throwIfAborted();
    return validateTranslation({ segments }, request.cues);
  }
}
