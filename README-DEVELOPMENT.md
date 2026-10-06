# Smart Subtitles for Hulu

> Unofficial tool, not affiliated with, endorsed by or sponsored by Hulu. "Hulu" is a trademark of its owner and is used only to describe compatibility. Personal, non-commercial use; provided as is, without warranty. See the [Terms of Use and Privacy Policy](extension/legal.html).

A local Windows service plus a Chrome extension that shows bilingual subtitles over native Hulu video: the original English subtitles and an AI translation into another language. Translation runs through the signed-in Codex, Google Cloud Translation, or a local Hy-MT2 model on the GPU.

## Usage

1. Double-click **Start Subtitles.cmd** to start the service (**Check Environment.cmd** checks Node, Codex and the service).
2. In Chrome open `chrome://extensions/`, enable developer mode and load the `dist\extension` folder of this project (created by `npm run build` or the start script).
3. After an update, click the extension's reload icon and refresh the Hulu page. Current version: **0.9.0**.
4. The popup has the subtitle toggle, the target language, the translator and episode progress; on failure it offers a retry.
5. Drag the subtitle lines with the mouse to move them up or down (vertical only). The position is kept as a share of the picture height, across full screen, episodes and reloads. Dragging never reaches the player.

The toggle only affects the extension's own overlay. It never changes Hulu's caption settings, playback or text tracks.

## Languages

Subtitles are translated from English into any language of the shared list in `shared/languages.js` (copied into the extension as `languages.js`) (about 55, default Chinese (Simplified)). A language is stored and sent as its code (`zh-CN`, `ja`, `es`, …), which is also the Google Cloud Translation code and part of the episode hash; prompts name it in English. Codex and Google support every listed language; the local Hy-MT2 model supports 37 of them, and the popup disables the others while the local translator is selected. Chinese, Cantonese and Japanese translations use full-width brackets for sound effects.

## Episode flow

When a video opens, the extension reads the complete subtitle file and timeline from Hulu's playback metadata, loaded subtitle responses or a complete TextTrack. Without a complete file it waits or reports an error; it never falls back to reading captions frame by frame.

- **Codex** gets the whole episode in one input: every subtitle numbered 1..n with its original text, no times. It returns one output with exactly one translation per number, in order (no merging, splitting or skipping). The output is parsed as it streams: each translation whose number continues the sequence is accepted and shown at once with its source cue's timestamps. If an attempt fails (a skipped or out-of-order number, an incomplete output), only the subtitles not yet accepted are sent again, with the accepted ones as context; an attempt without progress reports an error, and a retry also resumes after the accepted subtitles.
- **Local** shows each batch once it has been validated, following the video's `currentTime`; a retry continues after the accepted batches.
- **Google** shows the result when all requests have returned.

Seeking past the translated part shows no bilingual subtitle until it is reached. Only a complete, validated episode enters the cache.

## Translation database

Translations are stored on this computer in `data/episodes/subtitles.sqlite`:

- `sources`: one row per subtitle file. `hash` is the SHA-256 of the normalized subtitles (timing and text); `cues` holds their start, end and text, so an idx (0-based position) maps to its timestamps. Video URLs and cue IDs do not matter.
- `translations`: per source `hash`, `target` language and `provider`, `done` (how many cues, counted from idx 0, are translated) and `complete`.
- `lines`: the translated text per `(hash, target, provider, idx)`; `span` is 2 when the local model merged two cues into one line, otherwise 1.

A translation is written while it streams (at most once a second, and once more when it stops), so it may end at any idx. After a reload, a closed tab, a cancellation, an error such as a Codex usage limit, or a restart of the service, opening the same subtitles again resumes after `done` instead of starting over; the last accepted lines are sent as context only. A complete translation is validated before it is marked complete and is never overwritten by the same provider. The 0.9.0 `episodes` table is migrated on first start.

- The first complete result is reused by every mode, except that a **Codex** result replaces a local or Google one: Codex reads the whole episode at once, the others work batch by batch or line by line.
- Switching to Codex on an episode already translated by another mode keeps showing that translation until the Codex result is complete, then replaces it.
- Switching mode or language re-requests the episode; an adequate stored result returns immediately.
- Measured size: about 300 KB per 97-minute, 2310-subtitle episode (source and translation), i.e. roughly 2–4 GB for 10,000 two-hour films.

## Local mode (Hy-MT2)

Official Hy-MT2-7B Q8_0 weights live in `models/Hy-MT2-7B`; the llama.cpp Windows CUDA runtime in `runtime/llama.cpp`. The model loads on first use, listens only on `127.0.0.1:43128` with the pairing token, and no subtitle leaves the machine.

How an episode is translated:

1. **Names.** Recurring names, speaker labels and proper nouns are collected and translated once, then given to every batch and enforced in the output (e.g. `BEN:` and `Ben` both become 本).
2. **Batches** of up to 20 cues / 3500 characters, preferably ending at the end of a sentence, with the previous 4 translated lines and the next 4 source lines as context.
3. **Split sentences.** Two cues forming one sentence (the first lacks closing punctuation, gap ≤ 0.4 s, span ≤ 7 s) are translated as one unit and displayed over both cues. Translating them one by one made the model repeat or misorder the sentence.
4. **Constrained output.** A llama.cpp grammar fixes the output to `[number] source => translation` and copies the structure of the source: speaker dashes, bracketed labels and sound effects (in the source's bracket style), music notes. A sound effect translated once is reused verbatim. Free text is length-bounded and cannot contain markup, brackets, `=`, `#`, `*` or full-width look-alikes; these only ever appeared in degenerate output. Brackets become full-width for Chinese and Japanese.
5. **Validation and retries.** Each batch is validated (count, order, source alignment, merge limits, padding and over-long speaker lines). A failing batch is retried at temperature 0.2, then split in half. A single subtitle that still looks suspicious is accepted rather than failing the episode.
6. **Resume.** After an error or a cancellation the episode continues after the accepted batches (kept in memory); the name and sound tables are reused.

Cancelling stops generation but keeps the model loaded; it is unloaded after 10 idle minutes. Stopping the service stops the model process it started.

Settings in `config/local.json`: `localContextSize` (16384), `localGpuLayers`, `localBatchSize` (20), `localModelPort`, `localTranslationTimeoutMs` (per batch, 1 hour), `localTemperature` (0.7), `localIdleUnloadMs` (600000, 0 disables), `localSpeculation` (n-gram speculative decoding, default on). The context size reported by a running model server takes precedence over the configured one. The model log is `logs/local-model.log`.

Evaluation: `node scripts/test-local.mjs` checks idioms; `node scripts/test-local.mjs data/episodes/<file>.json 120` translates the first 120 cues of a saved episode and writes `data/evaluation/local-episode-120.json` (with retry count). Results on two real episodes are recorded in `docs/VALIDATION.md`. The model still mistranslates some slang and context (e.g. "Sweet fuck all", "I'm on seven"); use Codex when that matters.

## Codex and Google

Codex uses the official `codex app-server` with the existing ChatGPT login; no API key. The temporary thread has no file system, shell, browser or app tools, and subtitles are data only. Subtitles go to the account's model service and use its quota. The default is `gpt-6-luna` with `low` reasoning (`config/default.json`). The numbered output takes about 28 characters per subtitle; 600 real subtitles took 128 s, so a 2300-subtitle episode takes about 8 minutes. Override `model`, `effort`, `translationTimeoutMs` or `glossary` in `config/local.json`.

Google uses the official Cloud Translation Basic v2 within its limits of 128 strings and 5000 characters per request. Add `"googleApiKey": "..."` to `config/local.json` (or set `GOOGLE_TRANSLATE_API_KEY`) and restart. The key stays in the local service. Subtitles are sent to Google and billed to that account. Google translates every line independently, so sentences split across cues and context-dependent lines are often wrong.

## Security

The service listens only on `127.0.0.1:43127`; private endpoints require the random pairing token. Do not share `config/local.json` (it may contain the Google key) or `local-connection.json` in the build directory. Project files, logs and caches stay in this directory.

Supported subtitles: SRT/VTT and common TTML (inherited timing and nested span timing). Not supported: segmented VTT time mapping, sequential TTML, drop-frame timecodes, SAMI, audio-only recognition. The extension never downloads video or decryption keys.

Restart the service after changing configuration; double-click **Stop Subtitles.cmd** to stop it.

## Development

- `npm test` — automated tests.
- `npm run build` — refresh `dist/extension`.
- `npm run doctor` — environment check.
- `node scripts/e2e.mjs` — real Codex call through the episode endpoint and cache (result in `data/evaluation/service-e2e.json`).
- `node scripts/verify-local-service.mjs` / `node scripts/verify-progress.mjs` — local mode through the service, and progressive display.

The local demo video is for development only; the product always overlays native Hulu video. See `docs/VALIDATION.md`.

## Legal

- **Terms of Use, Privacy Policy and third-party notices:** `extension/legal.html`, opened from the popup ("Terms & Privacy"). The same file can be hosted as the privacy policy URL required by the Chrome Web Store.
- **Branding:** the product is named "Smart Subtitles for Hulu" and uses its own logo in a darker green than Hulu's brand colour, with an "unofficial" notice, so it is not mistaken for an official Hulu product.
- **Third-party software:** llama.cpp (MIT, © The ggml authors) and the Hy-MT2-7B model (Apache-2.0, © Tencent); their license files are in `runtime/llama.cpp` and `models/Hy-MT2-7B`.
- These texts reduce risk but are not legal advice; have them reviewed before a wide public release.
