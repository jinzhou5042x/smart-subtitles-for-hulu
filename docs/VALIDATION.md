# Validation record

## Exact timestamp/source output and durable publication (2026-10-06)

Output now uses original start–end timestamps as keys and emits `source` before `translation`. Runtime checks require exact timestamp strings and verbatim source text, including line breaks. Shared timestamps preserve separate cues and match their sources without merging. Source enums containing newlines were rejected by the live API, so source equality is enforced by the streaming parser instead. Database commits are read back before any progress is published; the final result is also loaded from SQLite rather than falling back to model output.

96 automated tests passed. A live 341-cue test used one thread and one turn, passed all timestamp/source checks and saved seven windows: 151.0 seconds, 26,819 input tokens, 12,128 output tokens (38,947 total). The run was staged separately, then its output was revalidated and installed after backing up the existing database. These are structural checks, not a proof of semantic accuracy. Inspection still found some cross-fragment phrasing, so the prompt was strengthened to prioritize fragment fidelity, followed by a focused six-cue live test of the previously problematic boundaries.

## Single input/output checkpoints (2026-10-06)

The production Codex path uses one thread and one turn per episode, on a resident app-server. Fixed output keys map to original IDs and timestamps. Three-minute video checkpoints consume the same stream without additional model calls. Unknown, duplicate, missing and empty keys are rejected; the final checkpoint waits for successful turn completion. No semantic review model is enabled.

A live 341-cue English-to-Simplified-Chinese run with `gpt-6-luna`, low reasoning, used one thread and one turn: 65.1 seconds, 15,542 input tokens (0 cached), 5,021 output tokens, 20,563 total. Seven timeline windows were saved. Inspection of the previously shifted regions showed the later dialogue aligned again, and the ending music cues were no longer duplicate padding. This sampled semantic check does not establish that every translation is correct.

The abandoned per-cue/new-thread experiment was stopped before completing the episode. Its first 59 cues used 349,464 input tokens (238,336 cached) and 1,560 output tokens. These partial numbers do not support an exact full-episode timing or token ratio. The per-cue and review-model paths were removed from production.

Windows / Node.js 22.23.1 / Codex CLI 0.160.0 / Chrome. Timings are observations on this machine, not guarantees.

## 0.6.0 (2026-10-05)

Automated: 49 tests pass (`npm test`), covering the local grammar, merging, bracket and name handling, degenerate-output detection, retry/split, checkpoint resume, the provider-ranked per-language cache with migration, and the numbered Codex alignment.

Local mode (Hy-MT2-7B Q8_0, llama.cpp b11429, CUDA), first 120 cues of two real episodes, compared with 0.5.3:

| Episode | 0.5.3 | 0.6.0 |
| --- | --- | --- |
| Parenthesised SDH, `BEN:` labels (1816 cues) | 50 s; split sentences repeated ("…每天为数百万人带来…" / "每一天都是如此"), sound effects without brackets, mixed dash styles, names inconsistent | 43 s, 0 retries; 120 cues → 108 segments, split sentences translated once, every sound effect bracketed and consistent, `-A-B` speaker dashes, names consistent (本, 艾尔西, 阿尔玛, 特伦斯) |
| Bracketed SDH, `[woman]` labels (2310 cues) | whole episode failed | 46–83 s, no corrupted lines; labels and effects as `（女人）`, `（犬吠声）` |

Still wrong in 0.6.0 (model limits, also wrong or worse in Google): "Sweet fuck all" → 完全没用, "leave your couch for Ben" → 把沙发让给本, "Top stories today." as a question.

Problems found during development and fixed in the grammar: unbounded free text ran to 15,580 tokens; forced spaces before a second speaker's dash and forbidding blank lines produced filler (`\n【音效】…`, `</p>`); forcing `[ ]` labels into `（ ）` led the model to improvise look-alikes (`＝`, `｝`, `．．．`) that following lines then imitated.

Codex (gpt-6-luna, medium), one input / one output on real subtitles of the bracketed episode:
- Output with copied millisecond timestamps, aligned by exact time: 2 of 2 runs of 200 subtitles rejected (one subtitle skipped near #188; the last subtitle dropped).
- Output with subtitle numbers only, timestamps taken from the source by number (current): 3 of 3 runs aligned exactly (200, 200 and 600 subtitles; 44 s, 44 s, 128 s; about 28 output characters per subtitle).
- Earlier format with hash IDs and long keys: about 50+ characters per subtitle, roughly 70% of a whole-episode output being JSON wrapping.

Full-episode local run, bracketed episode (2310 cues, previously failed): completed in 1081 s; 2310 cues → 2183 segments; 28 batch retries all recovered; no corrupted line found.

Not yet verified in the browser: a whole Codex episode with numbered output, and switching from a completed local translation to Codex.

## Hulu findings behind the current design

- Hulu's `#content-video-player` has no native TextTrack. The loaded subtitles are TTML whose first `p` element lacks begin/end, hence the support for inherited and nested span timing.
- A Hulu title reported `video.duration` as Infinity while the Timeline `aria-valuemax` was 5948, hence the timeline fallback when checking that a subtitle file covers the whole episode.
- The overlay is drawn on top of the native player and survives entering and leaving full screen; native caption settings are never changed.

## Not yet covered

- Ad transitions, autoplay to the next episode, other subtitle languages.
- Long continuous playback and rate limits.
- Audio-only recognition (out of scope).
- Sequential TTML containers, drop-frame timecodes, SAMI, segmented VTT time mapping.


## Disney+ 0.9.3 - Windows Chrome live check (2026-10-06)

- The Simpsons S1E1: English finite HLS WebVTT playlist captured through the restricted CDN fallback; 516 cues translated by Codex and restored from the local SQLite cache after page refresh.
- The player retained a hidden, empty video beside visible hivePlayer1 and reported infinite media duration. Visible-video selection and playlist-duration fallback cover this observed layout.
- Hive media time 54.242676 corresponded to the native pause announcement at 34.242 seconds. The extension learned the approximately 20-second offset from public player controls. Native English CC and the bilingual overlay both displayed the same galoshes dialogue at this position; native CC was restored to Off after comparison.
- The offset persists when controls disappear. Before the initial clock sample, a Hive player shows a prompt to reveal controls or pause, instead of using an uncalibrated media clock. Progress percentages have subsecond rounding limits; the English pause announcement offers finer calibration.
- All 77 automated tests passed. Coverage includes public shadow-DOM calibration, retained offset, route reset and waiting for a clock sample, alongside subtitle capture and security regression tests.
- Not verified: a complete uninterrupted viewing, ad breaks, autoplay between titles, other UI locales, worker-only playback metadata and mid-stream presentation discontinuities. No release was published.


## Ad recovery and user-managed credentials (2026-10-06)

All 100 automated tests pass; `npm run build` succeeds. New player tests cover Hulu and Disney ad transitions, stale pre-ad clocks, mismatched ad durations, repeated breaks, seek suppression, and a precise pause sample winning over stale controls. These are simulated DOM regressions, not a live ad-tier verification. Automatic recovery still depends on recognized ad markers and fresh public player controls.

A mocked Google request verifies that the user-selected key file takes precedence, is sent directly to the Google endpoint, and fails without fallback if missing or empty. No live translation request was needed for these checks.


## Hulu clock drift (2026-10-06)

Read-only inspection of the current Hulu player found `content-video-player.currentTime=215.949045`, integer timeline `215`, and an extension offset of `1.53974` seconds. That synthetic offset delayed subtitle rendering. Hulu's dedicated content player now uses its own precise clock and ignores the rounded timeline for calibration, including after ads. Disney retains its separate presentation-offset logic. Regression tests also reject repeated frozen timeline samples and stale CSS progress widths. Live playback after installing this fix remains to be confirmed by the user.
