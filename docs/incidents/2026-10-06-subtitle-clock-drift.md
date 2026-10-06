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
