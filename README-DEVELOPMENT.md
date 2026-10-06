# Smart Subtitles for Hulu

> Unofficial tool, not affiliated with, endorsed by or sponsored by Hulu. "Hulu" is a trademark of its owner and is used only to describe compatibility. Personal, non-commercial use; provided as is, without warranty. See the [Terms of Use and Privacy Policy](extension/legal.html).

A local Windows service plus a Chrome extension that shows bilingual subtitles over native Hulu video: the original English subtitles and an AI translation into another language. Translation runs through the signed-in Codex, Google Cloud Translation, or a local Hy-MT2 model on the GPU.

## Usage

1. Double-click **Start Subtitles.cmd** to start the service (**Check Environment.cmd** checks Node, Codex and the service).
2. In Chrome open `chrome://extensions/`, enable developer mode and load the `dist\extension` folder of this project (created by `npm run build` or the start script).
3. After an update, click the extension's reload icon and refresh the Hulu page. Current version: **0.9.4**.
4. The popup has the subtitle toggle, the target language, the translator and episode progress; on failure it offers a retry.
5. Drag the subtitle lines with the mouse to move them up or down (vertical only). The position is kept as a share of the picture height, across full screen, episodes and reloads. Dragging never reaches the player.

The toggle only affects the extension's own overlay. It never changes Hulu's caption settings, playback or text tracks.

## Languages

Subtitles are translated from English into any language of the shared list in `shared/languages.js` (copied into the extension as `languages.js`) (about 55, default Chinese (Simplified)). A language is stored and sent as its code (`zh-CN`, `ja`, `es`, …), which is also the Google Cloud Translation code and part of the episode hash; prompts name it in English. Codex and Google support every listed language; the local Hy-MT2 model supports 37 of them, and the popup disables the others while the local translator is selected. Chinese, Cantonese and Japanese translations use full-width brackets for sound effects.

## Episode flow

When a video opens, the extension reads the complete subtitle file and timeline from Hulu's playback metadata, loaded subtitle responses or a complete TextTrack. Without a complete file it waits or reports an error; it never falls back to reading captions frame by frame.

- The Codex app-server process stays resident. Each episode uses one thread, one input containing the full English subtitles, and one structured output. No per-cue requests or review-model calls.
- Each output key is the exact original start–end timestamp in seconds, with no index. Its value is `{"source":"verbatim English","translation":"translated fragment"}`. Source must appear first, and both timestamps and source text must match exactly, including original whitespace. Runtime checks enforce source equality because strict output schemas reject newline-containing enum literals. Unknown or duplicate timestamps, altered source text, duplicate fields, missing cues and empty translations fail validation. Overlapping cues with identical start/end times use an array under that timestamp and match by exact source, without merging cues.
- As that same response streams, complete contiguous windows of 60 seconds of video time are committed to SQLite and read back before publication. The frontend receives saved translations only. A failed write or read-back stops publication. No model requests are made at checkpoint boundaries. The final window waits for successful turn completion and full JSON validation.
- A retry keeps saved windows and sends the complete episode as context once, requesting only unsaved output keys. It does not retry automatically within the model call.

These checks establish the key mapping and structural completeness. They cannot prove that the model translated the correct meaning into each slot. Seeking past the saved part shows no bilingual subtitle until it is ready.

## Translation database

Translations are stored on this computer in `data/episodes/subtitles.sqlite`:

- `sources`: one row per subtitle file. `hash` is the SHA-256 of the normalized subtitles (timing and text); `cues` holds their start, end and text, so an idx (0-based position) maps to its timestamps. Video URLs and cue IDs do not matter.
- `translations`: per source `hash`, `target` language and `provider`, `done` (how many cues, counted from idx 0, are translated) and `complete`.
- `lines`: the translated text per `(hash, target, provider, idx)`; `span` is 2 when the local model merged two cues into one line, otherwise 1.

A complete window is saved in one transaction. `binding_version=1` identifies results with explicit source-slot binding. Older results are archived in `legacy_translations` and excluded from playback; they must be regenerated because correct numbering does not establish that each translation belongs to its source. The 0.9.0 `episodes` table is migrated on first start.

- The first complete result is reused by every mode, except that a **Codex** result can replace a local or Google one.
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

Codex uses the official `codex app-server` with the existing ChatGPT login; no API key. The temporary thread has no file system, shell, browser or app tools, and subtitles are data only. Subtitles go to the account's model service and use its quota. The default is `gpt-6-luna` with `low` reasoning (`config/default.json`). Output binds each translation to its exact original timestamp and source text; completion time depends on episode length and provider load. Override `model`, `effort`, `translationTimeoutMs` or `glossary` in `config/local.json`.

Google uses the official Cloud Translation Basic v2 within its limits of 128 strings and 5000 characters per request. Add `"googleApiKey": "..."` to `config/local.json` (or set `GOOGLE_TRANSLATE_API_KEY`) and restart. The key stays in the local service. Subtitles are sent to Google and billed to that account. Google translates every line independently, so sentences split across cues and context-dependent lines are often wrong.

## Security

The service listens only on `127.0.0.1:43127`; private endpoints require the random pairing token. Do not share `config/local.json` (it may contain the Google key) or `local-connection.json` in the build directory. Project files, logs and caches stay in this directory.

Supported subtitles: SRT/VTT and common TTML (inherited timing and nested span timing). Not supported: live HLS playlists, encrypted subtitles, sequential TTML, drop-frame timecodes, SAMI, audio-only recognition. The extension never downloads video or decryption keys.

Restart the service after changing configuration; double-click **Stop Subtitles.cmd** to stop it.

## Code layout

| Part | Files | Role |
| --- | --- | --- |
| Site profile | `extension/site.js` | Everything that depends on Hulu's web player: episode pages, the episode `<video>`, ad breaks, the timeline. Change only this file when Hulu changes its player or another site is added. |
| Subtitle discovery | `extension/capture.js` (page world) | Reads subtitle files the player loads or lists: playback JSON, HLS (segmented WebVTT, `X-TIMESTAMP-MAP`), DASH text tracks, `<track>`. |
| Parsing | `extension/core.js`, `extension/ttml.js` | VTT/SRT/TTML parsing, timing, picture geometry. |
| Overlay and episode flow | `extension/content.js` | Picks the complete English file, requests the translation, draws the two lines, reports status to the popup. |
| Popup | `extension/popup.*` | Settings, status, progress and token usage; light and dark. |
| Background | `extension/background.js` | Settings storage, pairing, the only code that talks to the service. |
| Service | `service/server.mjs`, `episodes.mjs`, `jobs.mjs`, `database.mjs` | HTTP API on 127.0.0.1, per-episode state, up to `maxAgents` (16) translations at once, SQLite. |
| Translators | `service/codex.mjs`, `google.mjs`, `local*.mjs`, `translation.mjs` | Codex app-server threads (token usage included), Google, local model; prompts and validation. |

Ad breaks: the overlay hides while a detected ad is playing. After the break, the player profile discards the old clock offset and waits for fresh content timing before showing subtitles again. The overlay hides during every ad break (pre-roll and mid-roll, also while an ad is paused) and the popup waits for the episode to start before it reports that no subtitles were found.

## Releasing

1. `npm run bump -- 0.9.3` sets the version in `package.json` (read by the service) and `extension/manifest.json` (read by the extension).
2. `npm test` (also run by GitHub Actions on every push).
3. `npm run package` and `node scripts/store-assets.mjs` for the Chrome Web Store; `npm run release` for the Windows service zip.

## Development

- `npm test` — automated tests.
- `npm run build` — refresh `dist/extension`.
- `npm run doctor` — environment check.
- `node scripts/e2e.mjs` — real Codex call through the episode endpoint and cache (result in `data/evaluation/service-e2e.json`).
- `node scripts/verify-local-service.mjs` / `node scripts/verify-progress.mjs` — local mode through the service, and progressive display.

The local demo video is for development only; the product always overlays native Hulu video. See `docs/VALIDATION.md`.

User research (complaints about dual-subtitle tools, competitors, Hulu's web player and its corner cases) and the resulting priorities: `docs/research/user-pain-points.md`, with sources in `docs/research/notes/`. Notes for coding agents: `CLAUDE.md`.

## Legal

- **Terms of Use, Privacy Policy and third-party notices:** `extension/legal.html`, opened from the popup ("Terms & Privacy"). The same file can be hosted as the privacy policy URL required by the Chrome Web Store.
- **Branding:** the product is named "Smart Subtitles for Hulu" and uses its own logo in a darker green than Hulu's brand colour, with an "unofficial" notice, so it is not mistaken for an official Hulu product.
- **Third-party software:** llama.cpp (MIT, © The ggml authors) and the Hy-MT2-7B model (Apache-2.0, © Tencent); their license files are in `runtime/llama.cpp` and `models/Hy-MT2-7B`.
- These texts reduce risk but are not legal advice; have them reviewed before a wide public release.

## Disney+ (0.9.3)

`extension/sites.js` centralizes trusted website origins and Disney subtitle CDN validation; both script worlds and the background worker load it. `site.js` recognizes Disney+ `/play/` and `/video/` routes with optional locale prefixes, selects the visible video and uses finite HLS playlist duration when video.duration is infinite. Disney content time is calibrated from the public shadow-DOM progress bar or millisecond pause announcement, then retained when controls decay. Uncalibrated Hive players show a sync prompt instead of mistimed dialogue. Hulu keeps its own player and timeline selection.

`capture.js` observes playback JSON including `/media/.../scenarios/...`, follows HLS master URLs, selects non-forced English subtitle tracks, joins finite WebVTT playlists and deduplicates boundary cues. A CORS failure on `.dssott.com` or `.dssedge.com` subtitle/playlist files can use a bounded extension fetch, with no cookies and no redirects. It cannot request video segments, license endpoints, arbitrary hosts or local addresses. This requires the additional CDN host permissions in the manifest. Native caption settings remain under user control.

Validation: `node --test tests/disney.test.mjs` exercises origin checks, locale routes, video selection, full screen parent selection, Hulu ad regression, Disney playback JSON to HLS subtitles, live/encrypted playlist rejection and bounded CDN reads. Live validation on Windows Chrome captured and translated all 516 English cues from The Simpsons S1E1, restored them from the local cache after refresh, and matched a displayed line against native English CC. That Hive player had a 20-second presentation offset, calibrated from its controls rather than hardcoded. Progress-bar calibration has subsecond rounding limits; the English pause announcement gives millisecond precision. Worker-only playback metadata, extensionless segments, mid-stream discontinuities, ad layouts, and other UI locales remain unverified. See docs/VALIDATION.md.


## Your API key

Translation requests go directly from the local companion to the selected provider, without a project-operated relay. Codex uses your existing login. For Google, store the key alone in a UTF-8 text file outside the repository, at a location you control, and set `googleApiKeyFile` in `config/local.json` to its absolute path (for example `C:/Users/you/Keys/google-translate.txt`). Enable `google` in `providers` if needed, then restart the companion. The key file takes precedence over the legacy `googleApiKey` setting and `GOOGLE_TRANSLATE_API_KEY` environment variable. An unreadable or empty selected file fails rather than silently using another key. Keep that file private to your Windows account; it is not copied into the extension or cache.

Disney ad recovery invalidates its presentation offset on detected ad transitions. Hulu uses its dedicated content video clock unchanged, before and after ads; its integer UI timeline must never calibrate subtitle time. While waiting, it sends up to four mouse-move events to reveal controls, without pausing or seeking. Subtitles remain hidden until a fresh timeline or pause announcement supplies a content clock. An unchanged slider is rejected after the break; a previously known content duration also guards against reading an ad timeline. New pages reset this state. This depends on the site's exposed ad markers and timing controls; real ad-tier playback remains unverified.


Clock incident and regression requirements: [Hulu subtitle clock drift](docs/incidents/2026-10-06-subtitle-clock-drift.md).
