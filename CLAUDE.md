# Smart Subtitles for Hulu: notes for agents

Bilingual subtitles on Hulu: a Chrome extension (hulu.com only) plus a local Windows companion
service that translates the episode's English subtitles with Codex through the user's own ChatGPT
sign-in. Everything stays on the user's computer; there is no server of ours.

- User docs: `README.md`. Developer docs, code layout and release steps: `README-DEVELOPMENT.md`.
- Store submission texts: `docs/store/LISTING.md`. Validation history: `docs/VALIDATION.md`.
- User research and Hulu player research (2026-10): `docs/research/user-pain-points.md` (report,
  Chinese) and `docs/research/notes/` (sources and quotes). The Hulu/Disney+ API field names in
  there come from 2021–2024 open-source code and have not been checked against live 2026 traffic.

## State (2026-10-06, version 0.9.2)

- `main` is pushed and GitHub Actions (`.github/workflows/test.yml`) runs `npm test` on every push.
- Chrome Web Store: the item is filled in (store listing, privacy, Public visibility). 0.9.0 was
  the first upload; `npm run package` builds the current zip in `dist/store/`, and
  `node scripts/store-assets.mjs` renders the screenshots. Upload and review are done by the owner.
- GitHub Releases only has the 0.9.0 Windows service zip. A new one needs `npm run release` on
  Windows (it downloads the official Node.js and uses Windows' tar.exe), then a manual upload.
- Not verified on real Hulu since 0.9.1: HLS/DASH subtitle capture, ad-break handling, 16
  concurrent videos with a real Codex app-server. Ask the owner to test on Windows, or for a HAR
  of a hulu.com episode, before relying on these.

## Decisions the owner made (do not reopen without being asked)

- Local only: each user runs the service with their own ChatGPT/Codex account and their own data.
  A shared family/central backend was built and dropped; do not reintroduce it.
- Model `gpt-6-luna`, effort `low` (`config/default.json`). The release enables Codex only.
- Keep Codex resident. One episode uses one input and one output, never one request per cue.
  Output uses fixed original start–end timestamps, with verbatim source FIRST then translation.
  Require exact timestamp + source matches; no fuzzy matching, merging or moving cue fragments.
  Save and read back complete 1-minute video windows before publishing; checkpoints must not
  cause model calls. No review-model gate.
- Hulu clock invariant: use dedicated content-video-player.currentTime unchanged; NEVER calibrate it from the rounded UI timeline. Disney has a separate offset policy. See docs/incidents/2026-10-06-subtitle-clock-drift.md before changing clock code.
- Up to 16 videos translate at once (`maxAgents`); closing a tab stops its translation, a reload
  resumes from the progress saved in SQLite.
- Real dialogue in tests and docs is fine. Personal information about the owner is not (below).

## Rules

- Commits are authored as `jinzhou5042x <338366557+jinzhou5042x@users.noreply.github.com>` (the
  repository's local git config). Never add `Co-Authored-By` or any other AI/assistant attribution
  to commits or PRs, and never put the owner's real name, personal email or other GitHub account
  in the repository, its history, the extension package or store texts. History has been rewritten
  for this once; keep it clean.
- Commit and push when the owner asks. Check `git status` first: `dist/`, `data/`, `config/local.json`
  and `logs/` are ignored and must stay out of the repo.
- The published extension must not contain anything of ours beyond the product itself (no
  pairing file, no title-specific IDs, no developer paths). `npm run package` strips the pairing file.

## Working here

- `npm test` (node:test, Node 22+) runs everywhere. Most of `scripts/` and the `.cmd`/`.ps1`
  launchers are Windows-only; this checkout may be on Linux, where Hulu, Codex and the local model
  are not available.
- `npm run package` works on Windows (tar.exe) and elsewhere (zip/unzip).
- `node scripts/store-assets.mjs` needs Chrome: set `CHROME_PATH`; as root on Linux point it at a
  wrapper that adds `--no-sandbox`. It renders the real popup (`dist/extension`, so run
  `npm run build` first) with sample data; check the PNGs for clipping after UI changes.
- UI changes: render the popup in its states (working, done, error, pairing, long texts, large
  numbers, dark mode) and check that nothing overflows or is cut off; the owner cares about this.
- Version: `npm run bump -- x.y.z` (package.json and manifest.json; everything else reads them).

## Where things are

- Anything that depends on Hulu's player (episode page, `#content-video-player`,
  `#ad-video-player`, timeline): `extension/site.js` only.
- Subtitle discovery in the page world: `extension/capture.js` (playback JSON incl.
  `transcripts_urls`, HLS segmented WebVTT with `X-TIMESTAMP-MAP`, DASH text tracks, `<track>`).
- Episode flow, overlay and popup status: `extension/content.js`; popup: `extension/popup.*`.
- Service: `service/server.mjs` (API on 127.0.0.1:43127, pairing token), `episodes.mjs`
  (per-episode state, resume, Codex token usage), `jobs.mjs` (concurrency), `database.mjs`
  (SQLite: `sources`, `translations`, `lines`), `codex.mjs` (app-server threads).

## Next work, by priority (from docs/research/user-pain-points.md)

1. P0: Hulu titles inside disneyplus.com (Hulu is moving into Disney+ by the end of 2026): a site
   profile for Disney+, its manifest match and host permission, reuse the HLS parsing. Needs a
   real HAR to confirm the player's requests (it may fetch manifests in a worker).
2. P0: say on the player why subtitles are missing (no English track, live TV, encrypted
   captions, player changed) and add a "copy diagnostics" action for issue reports.
3. P1: a macOS companion service; optional hiding of Hulu's own captions; show only one line or
   swap their order; colour/opacity; keyboard shortcuts.
4. P2+: learning features (word lookup, export) only if the audience asks; non-English sources,
   several target languages, SAMI, Live TV last.

## Local follow-up: Disney+ implementation (0.9.3)

Disney+ playback profiles, sender validation, settings broadcasts, English HLS discovery and a restricted CDN CORS fallback are now implemented. See README-DEVELOPMENT.md and tests/disney.test.mjs. Windows Chrome live validation captured and translated 516 cues from The Simpsons S1E1 and matched native English CC after public-control clock calibration. See docs/VALIDATION.md for evidence and remaining limitations. Ad tiers and long playback remain unverified. No release upload or push was performed.
