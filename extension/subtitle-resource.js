import './sites.js';

// A bounded, credential-free fallback for subtitle CDNs without page CORS headers.
export async function readSubtitleResource(url, fetcher = fetch) {
  if (!globalThis.SubtitleSites.subtitleResource(url)) throw new Error('Unsupported subtitle URL');
  const response = await fetcher(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Subtitle download failed (${response.status})`);
  const limit = 5_000_000;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Subtitle file is too large'); }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Subtitle file is too large');
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*(?:\uFEFF)?(?:WEBVTT|#EXTM3U|<\?xml|<(?:\w+:)?tt[\s>]|\d+\s*\r?\n\d[\d:.]*\s*-->)/.test(text)) throw new Error('Response is not a subtitle or playlist');
  return { text, mime: response.headers.get('content-type') || '' };
}
