# Validation record

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
