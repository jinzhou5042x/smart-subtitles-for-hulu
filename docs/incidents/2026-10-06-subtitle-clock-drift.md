# Hulu subtitle clock drift — 2026-10-06

## Observed failure

The user reported that the current Hulu episode's subtitles appeared roughly one second late. Read-only inspection of the running page found:

- Dedicated content video time: 215.949045 seconds.
- Accessible timeline value: 215 seconds (integer precision).
- Extension clock offset: 1.5397399999999948 seconds.
- Effective subtitle lookup time: approximately 214.409305 seconds.
- All 654 translations had already been saved; translation progress was complete.

This established a display-clock error. It did not establish that the source track itself is perfectly synchronized to every spoken word.

## Root cause

The ad-recovery change generalized Disney's presentation-clock calibration to Hulu. Disney may require a presentation offset, but Hulu's dedicated `content-video-player` already uses the subtitle timeline. Sampling an integer UI progress value and subtracting it from precise `video.currentTime` introduced a false offset.

The old algorithm accepted the same slider sample repeatedly. Once the video advanced more than the 1.5-second threshold while the controls stayed stale, it changed the offset again. That threshold was an error trigger, not a legitimate correction or synchronization guarantee. A separate issue trusted CSS progress width even when it lagged behind the numeric timeline.

Existing tests covered a Disney offset and identifiable ad transitions but omitted Hulu's subsecond clock against an unchanged integer slider. Passing those tests was insufficient evidence for live synchronization. Earlier statements that calibration was fixed were premature.

## Correction (0.9.4)

- Hulu never enters UI-based offset calibration. Its subtitle time is the dedicated content video's finite `currentTime`, unchanged. Seeking and recognized ads temporarily suppress subtitles.
- Hulu player discovery requires its dedicated content element. Temporary absence does not select an intro or advertisement as the episode.
- Disney retains a separate clock policy. Identical control samples cannot repeatedly alter the offset. Pixel widths, invalid numbers and visual widths inconsistent with numeric time are rejected or ignored.
- A known content duration that unexpectedly changes invalidates Disney calibration, even without a recognized ad marker. Source/route changes require a fresh clock when replacing an existing clock.
- Subtitle timestamps and cached translations are not rewritten. This change fixes rendering, not translation semantics.
- Local DOM diagnostics expose `clockPolicy`, `mediaTime`, `subtitleTime`, `clockOffset` and extension version, without adding popup clutter or network telemetry.

## Regression evidence

117 automated tests pass. Focused coverage includes the exact observed fractional Hulu time, paused/running playback, rate changes, seeks in both directions, source and route replacement, repeated ads, absent/hidden content elements, frozen Disney controls, stale CSS widths, invalid timeline values and unidentified ad-duration changes. Frozen-control and stale-width tests failed before the corresponding fixes.

## Rollout and remaining verification

Build is 0.9.4 so the running page can be distinguished from older code. The user reloads the extension and video page; translation cache remains reusable. For Hulu, verify `clockPolicy=hulu-media-v1`, `clockOffset=0`, and equality of sampled media/subtitle times. Observe actual dialogue and mid-roll recovery before claiming all ad scenarios are verified.

No UI progress bar is an authoritative clock for Hulu. Do not reintroduce cross-site calibration or a fixed title-specific offset. Unknown player architectures require separate evidence and tests. Unrecognized ads with no distinguishing public signals remain a limitation; this patch does not claim universal ad detection.

## Disney follow-up (2026-10-09)

A report of rapid subtitle changes exposed a missing Disney regression: the numeric
timeline can freeze while the progress bar's CSS width keeps animating. The sample
signature included that width, so each animation change could recalibrate against
the old timestamp. A regression reproduced subtitle time jumping from 101.6 back
to 100 seconds during forward playback.

`disney-controls-v3` identifies fresh samples by numeric current time and duration
only. CSS animation cannot refresh a stale sample, invalidate a precise pause
sample, or satisfy the fresh-clock requirement after ads. The regression exercises
100 forward-playback samples with both animated and resetting widths. This proves
the clock no longer rewinds in that scenario; live dialogue and ad-tier playback
still require verification.

## Code review follow-up (2026-10-09, not yet verified in live playback)

A read-through of the whole sync path found five Disney-side defects, each reproduced by a
regression test that failed before its fix. Hulu's clock (`hulu-media-v1`) is unchanged.

- The clock was created on the first overlay tick, before a subtitle file was selected, and kept
  that tick's origin (0). An uncalibrated clock now follows the selected file's origin.
- A new video element on the next title accepted the previous title's frozen slider value and
  pause announcement as its first sample. A route change now requires a fresh sample for a new
  element too, as it already did for a reused one.
- The first timeline duration seen was treated as the episode's for the rest of the page. When it
  belonged to an unrecognized pre-roll, every later sample was rejected and subtitles never
  returned. The longer duration now replaces it and is calibrated afresh; the shorter one is
  still never adopted.
- The "move your pointer or pause" prompt appeared on every seek, including on Hulu, where no
  viewer action is needed. It is now limited to a Disney clock that is waiting for a sample.

- The first timeline reading could be seconds late (see the live measurement below).

`site.js` was restructured without changing Hulu: reading the controls, ad breaks, the Hulu clock
and the Disney clock are separate parts, and the Disney clock is one class with named phases
(origin, synced, waiting) in place of independent flags.

Separately, the translation cache returned the highest-ranked translator's result for every
translator and showed it as a preview while another one worked, so the overlay could show lines
that did not come from the selected translator. Results and progress are now strictly per
translator.

## Live measurement on Disney+ (2026-10-09) and `disney-controls-v5`

Measured in the owner's Chrome on a film (Hive player, timeline maximum 5491 s), reading the page
through AppleScript; the reference was the pause announcement, which agreed with the native
subtitle cue on screen.

- `aria-valuenow` is written once, as whole seconds, when the controls appear and then stays
  frozen during playback (348 for 26 s of playing). It is not a clock.
- The progress bar's width is rewritten about every 0.26 s and gave the title time within
  4–23 ms of the pause announcement over 35 consecutive readings.

This reverses the reading of the 2026-10-09 follow-up above: the width was the live value and
the number the stale one. `v3` identified readings by the number, so only the first one counted,
and it fell back to the frozen number whenever the bar was more than 1.5 s past it: a first
reading taken later than that after the controls appeared left subtitles late by that amount.
`v5` reads the bar as the live value (the number only as a floor, or alone when there is no
usable bar), lets later bar readings lower the offset by up to 0.3 s, never raise it, and takes
a jump above 1.5 s from the bar only when the next reading agrees.

Run inside the live page from a blank state, as after a reload, `v5` was 162 ms late on its
first reading, within 50 ms after 0.15 s and within 21 ms from 0.9 s on, for the 10 s measured.

The same session showed that the film's English SDH track and its native Chinese subtitle track
are timed independently: over 18 matching lines their start times differ by −0.61 to +0.46 s,
line by line, with no constant offset. The overlay follows the English SDH times exactly, so
it cannot coincide with the native subtitles, whatever the clock does.

## Second live session (2026-10-10) and `disney-controls-v6`

A second film (timeline maximum 7726 s), with the packaged `v5` running and the next version
injected beside it from a blank state. Seeks were made with the player's own ±10 s buttons.

- **Every seek restarts the Hive media time** (20.00, 17.17 and 18.73 s were seen), so the offset
  learned before it is void at once. The `seeking` flag was up for less than 100 ms, shorter than
  one 150 ms poll, and `v5` then waited for a second agreeing bar reading: for 313–542 ms after
  each of four seeks it showed a subtitle time that was wrong by 10 to 210 seconds. `v6` voids
  the offset on the element's `seeking` event, on the flag, or when media time runs backwards,
  and takes the first bar reading after the seek. In the same four seeks it showed nothing for
  at most 165 ms and no wrong time beyond the poll in which the seek happened.
- The first bar reading after a seek shows the target while playback resumes about 0.1 s before
  it. It is marked `first` and replaced by the next reading during playback.
- **After a reload the film played for two minutes with all 1751 translations loaded and no
  subtitle.** The clock asked the player for its controls only in the waiting phase, at most
  four times; a page that has just loaded is in the origin phase and never asked. One synthetic
  pointer move on the video reveals the controls. `v6` asks whenever a Hive clock has no
  reading: at once, then after 1, 2, 4 ... up to 30 s. Started blank with the controls hidden,
  it had a subtitle time after 154 ms and was within 5 ms of the packaged overlay's settled
  offset after 0.76 s, and kept it after the controls hid again. The pointer prompt now appears
  only after the first request has gone unanswered for a second.
- A bar behind the frozen number is still the live value (after a rewind); the number is no
  longer used to judge the bar.
- Between polls the settled offset was 65–80 ms above the freshest bar reading: a changed bar is
  seen up to one poll late and the 150/265 ms rhythms rarely line up within four seconds.
- This film's English SDH track agrees with its native subtitle track: start times differ by a
  median of −0.08 s and 82% of 258 lines are within 0.3 s. The first film's tracks did not agree.
- Translation records were per translator in the real database: Codex and Google each hold a
  complete record for the first film.

Still unverified: `v6` as the packaged extension through a real reload (it was run injected),
ad breaks and ad markers on Disney, a pointer drag on the bar in a real player, autoplay to a
next episode, and everything on Hulu.

## "Subtitles ready" over an empty screen (2026-10-10)

On a 50-minute Disney+ episode the popup said the subtitles were ready and nothing was shown. Read
from the page: the Hive element's `duration` was 133.3 s, the end of what it had buffered, not
the episode's length. The completeness check compared files with that number, so the 884-line
English playlist (ending at 2986 s) failed it and a 2-line segment of another track, captured from
the player's own request and ending at 132.9 s, passed as the whole episode. A selected file is
never replaced, so the page stayed that way. Earlier titles had reported no duration at all, and
the code then fell back to the playlist's own length, which is why this had not shown before.

On Disney the title's length is now only the length of a file's own complete playlist; the
element's duration is not used and loose segments never qualify (`titleSeconds` in `site.js`,
`coversTitle` in `core.js`). Hulu is unchanged.

The same page held six overlay elements. Each reload of the extension leaves the old page script
running without a connection; it kept drawing, and the new script removed only the first overlay
it found. A script that has lost its extension now stops and removes its overlay, and a new one
removes all that are left. Scripts from before this change stay until the page is reloaded.

Not verified in the browser: the fix needs the extension and the page reloaded.
