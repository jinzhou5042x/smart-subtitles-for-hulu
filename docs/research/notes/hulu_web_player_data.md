# How the Hulu web player (and Hulu-on-Disney+) gets playback data and subtitles

Research date: 2026-10-05. Most technical sources here are OLD (2021 to 2024). Hulu and Disney do not publish public docs for these internal APIs. Everything that describes the API comes from third-party open-source clients that reverse-engineered it. Treat field names as "last known", not as guaranteed in 2026. Inferences are marked **[INFERENCE]**.

## 1. Hulu playback API: endpoints, structure, where subtitles appear

### Takeaway
On hulu.com the player POSTs a JSON "playlist" request to `play.hulu.com/v6/playlist`. The response carries a DASH (`stream_url`) manifest URL, a Widevine license URL, and a separate `transcripts_urls` object (format → language → URL) for side-loaded caption files (smi, webvtt, ttml). In the last known structure, subtitles come from this JSON, not from text tracks inside the DASH manifest.

### Cited Findings
- A Go Hulu client (published module version dated 2021-12-09) POSTs to `https://play.hulu.com/v6/playlist` with a JSON body. Earlier steps are `POST https://play.hulu.com/config`, which returns an AES-encrypted config holding `playlist_v4/v5/v6` endpoint names, and `GET https://discover.hulu.com/content/v5/deeplink/playback?namespace=entity&id=<id>…`, which maps a /watch id to an EAB id. Auth is the `_hulu_session` cookie plus `Origin: https://www.hulu.com`. — [six-eleven/hulu client (pkg.go.dev)](https://pkg.go.dev/github.com/six-eleven/hulu/client); source from [proxy.golang.org module zip](https://proxy.golang.org/github.com/six-eleven/hulu/@v/v0.0.0-20211209122131-39727e2d777b.zip)
- Request body fields: `content_eab_id`, `deejay_device_id` (208 for web), `version`, `device_identifier`, `guid`, `kv` (session key from config), `unencrypted: true`, `language: "en"`, `play_intent: "resume"`, `ignore_kids_block`, `device_ad_id`, `limit_ad_tracking`, `region`, `all_cdn`. It also has `playback.manifest` with `type: "DASH"`, `multiple_cdns`, `patch_updates`, `hulu_types`, `live_dai`, `multiple_periods`, `xlink`, `secondary_audio`, `live_fragment_delay`, plus `playback.segments` (FMP4, CENC) and `playback.drm` (WIDEVINE MODULAR). — same source
- Response fields: `stream_url`, `mbr_manifest`, `wv_server`, `dash_pr_server`, `audio_tracks[]` (language, role, codecs), `resume_position`, `initial_position`, `recording_offset`, `ad_break_times[]`, `breaks[]`, `use_manifest_breaks`, `adstate`, `breakhash`, `transcripts_default_on`, and `video_metadata` (`has_captions`, `length`, `language`, `end_credits_time`, `segments`, `markers`, `has_network_pre_roll`, `interstitials`). The client also lists `sauron_token`/`sauron_id`, `view_ttl_millis` and `asset_playback_type`. — same source
- Subtitles: `transcripts_urls: { smi: {en: url}, webvtt: {en: url}, ttml: {en: url} }`. Hulu calls subtitles "transcripts". The Go client only models the `en` key, but the object is keyed by language. — [six-eleven/hulu client docs](https://pkg.go.dev/github.com/six-eleven/hulu/client); [TheMegafuji/hulu (pkg.go.dev)](https://pkg.go.dev/github.com/TheMegafuji/hulu/hulu); [mojopix/hload client](https://pkg.go.dev/github.com/mojopix/hload/client)
- The response also has `transcripts_encryption_key` / `transcripts_encryption_iv`. The client sends `unencrypted: true`, which suggests caption files can be encrypted unless the client asks for plain files. — [six-eleven/hulu types](https://pkg.go.dev/github.com/six-eleven/hulu/client)
- A newer Gitea mirror of "unshackle-services" (a Hulu service plugin) references `playlist_v5` in its API config. I only saw this in a search snippet, because the commit page returned 404 when fetched. — [drm-free.duckdns.org unshackle-services commit (snippet only)](https://drm-free.duckdns.org/thegame_1980/unshackle-services/commit/5c40e129be64df6522aeef4c7d1edc39fbfdd922)
- yt-dlp has no Hulu extractor and no Disney+ extractor. Its supported-sites list has only "Disney" (the legacy Disney sites extractor `disney.py`). — [yt-dlp supportedsites.md](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/supportedsites.md)

### Inferences
- **[INFERENCE]** The extension's current URL regex `/playback|playlist|manifest|asset/` matches `play.hulu.com/v6/playlist`. It also matches `discover.hulu.com/.../deeplink/playback`, which has no subtitles, and that is harmless. The key to read is `transcripts_urls` (nested format → lang). Prefer `webvtt` over `ttml` over `smi`. Accept language keys `en`, `en-US` and `eng`, case-insensitive.
- **[INFERENCE]** Because the web player sends `unencrypted: true`, caption URLs seen in the page's own playlist response should be plain text. If a response ever has a non-empty `transcripts_encryption_key`, the file may be encrypted and the extension should report that rather than show garbage.
- **[INFERENCE]** The request has `xlink: false`, `multiple_periods: true` and `use_manifest_breaks`. So the DASH MPD may contain several Periods, which could include ad Periods on some paths. The extension should not treat MPD text AdaptationSets as authoritative when `transcripts_urls` exists.
- **[INFERENCE]** Caption URLs (historically on Hulu asset CDNs such as `assets.huluim.com`) are probably plain CDN links, maybe signed or with a TTL. I found no public source confirming the host, the signing or CORS headers.

### Gaps
- I found no public 2025-2026 capture of the exact current web playlist version (v6 vs. newer), or of whether `transcripts_urls` still exists. Verify with a live DevTools capture.
- No source confirms whether Hulu's DASH manifests now carry text AdaptationSets (stpp/wvtt), or whether CEA-608/708 is embedded in the video.
- I found no source for the caption host names, URL expiry, or CORS/credentials requirements.

## 2. Timing: ads, offsets, and video.currentTime

### Takeaway
Hulu describes its ad approach as "server-guided" insertion: the server says what plays next, but ads are not stitched into the content stream. On the web, ads play in a separate `<video>` (#ad-video-player). So the content timeline, and the subtitle file timestamps, should match #content-video-player's `currentTime` with no ad offset. Disney+ also asks for `assetInsertionStrategy: "SGAI"` (server-guided ad insertion).

### Cited Findings
- Hulu's live/OTT ad approach is "Server-Guided": "There is no stitching on the server, but the server is informing you where to get the next video from." (2020 talk summary) — [The Broadcast Knowledge, 2020-09-17](https://thebroadcastknowledge.com/2020/09/17/video-scalable-per-user-ad-insertion-in-live-ott/)
- In client-side ad insertion the content stream stays unmodified and the client switches between content and ad streams. — [Amazon Vega CSAI overview](https://developer.amazon.com/docs/vega/0.24/client-side-ad-insertion-overview-vega)
- The Hulu playlist response gives ad positions as metadata (`ad_break_times[]`, `breaks[]`, `use_manifest_breaks`, `adstate`). It also has `recording_offset` (Live TV DVR) and `resume_position` / `initial_position`. — [six-eleven/hulu types](https://pkg.go.dev/github.com/six-eleven/hulu/client)
- The Disney+ playback POST body (in Subtitle-Downloader's code, last changed 2024-05-09) includes `assetInsertionStrategy: 'SGAI'`, `playbackInitiationContext: 'ONLINE'`, `slugDuration: 'SLUG_500_MS'`. The client reads `stream.sources[0].complete.url`, an HLS master. — [wayneclub/Subtitle-Downloader disneyplus.py](https://github.com/wayneclub/Subtitle-Downloader/blob/main/services/disneyplus/disneyplus.py)
- HLS WebVTT: "an X-TIMESTAMP-MAP metadata header SHOULD be added to each WebVTT header", in the form `X-TIMESTAMP-MAP=LOCAL:<cue time>,MPEGTS:<MPEG-2 time>`. Without it, "the client MUST assume that the WebVTT cue time of 0 maps to an MPEG-2 timestamp of 0." — [RFC 8216 §3.5](https://www.rfc-editor.org/rfc/rfc8216.html)
- A typical segment header is `X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000`. 900000 at 90 kHz is 10 s. Each segment must contain every cue shown during its EXTINF window, and a cue's times may extend past that window, so cues repeat across segments. — [FFmpeg trac #4048](https://trac.ffmpeg.org/ticket/4048); [gstreamer hlswebvttsink](https://gstreamer.freedesktop.org/documentation/hlssink3/hlswebvttsink.html)
- Broadcast-origin subtitle files sometimes start at 01:00:00:00 rather than 0, which causes sync problems on streaming platforms. — [vsubtitle.com Disney+ vs Prime comparison](https://vsubtitle.com/disney-plus-vs-amazon-prime-video-subtitle-standards/) (low-authority source)

### Inferences
- **[INFERENCE]** On hulu.com, a side-loaded `transcripts_urls.webvtt` file should be in content time (0 = start of the episode). It should line up with `#content-video-player.currentTime` with no ad shift, because ads live in `#ad-video-player`. A user who briefly saw "no subtitle link found" fits this. During pre-roll the content playlist may not have been parsed yet, or the status check ran before it arrived. Fix: keep the hook passive. Don't treat "not found yet" as final while `#ad-video-player` is visible and playing, or while `#content-video-player` has no `currentSrc` or `readyState` is 0.
- **[INFERENCE]** For segmented WebVTT (HLS, mainly Disney+): de-duplicate cues by (start, end, text) after joining. Convert each segment's cue times using its own X-TIMESTAMP-MAP: `t_content = cue - LOCAL + MPEGTS/90000 - firstVideoPTS`. If the video's first PTS is also 10 s (MPEGTS 900000 matching a 10 s video start), the net offset is 0. Don't hard-code a 10 s subtraction. Instead, check alignment against `video.currentTime` (for example, compare with the player's own rendered cue text, or fall back to the extension's manual offset UI).
- **[INFERENCE]** With SGAI or interstitials (Disney+ ad tier), ads are separate assets. The primary content timeline should not be shifted, but the player's `<video>` element may be reused for ads. The extension should not assume a separate ad `<video>` on disneyplus.com.
- **[INFERENCE]** Hulu Live TV (`recording_offset`, `live_dai`) is linear and uses dynamic ad insertion. A "complete subtitle file" does not exist there. Captions are likely in-band (608/708) or in live segments. Treat live as out of scope or best-effort.

### Gaps
- No primary 2024-2026 source confirms that Hulu VOD on the web is still client-side with a separate ad `<video>`. The evidence is the extension's own DOM observation (#ad-video-player) plus the 2020 "server-guided" talk.
- I found no source for "No Ads" vs "With Ads" differences in the playlist (for example an empty `breaks`).

## 3. When the playlist is fetched (pre-roll, resume, autoplay, profiles)

### Takeaway
I found no public source. Everything below is inferred from the API shape and has to be verified live.

### Cited Findings
- The playlist request carries `play_intent: "resume"` and the response carries `resume_position` / `initial_position`, so resume is decided server-side per playlist call. — [six-eleven/hulu](https://pkg.go.dev/github.com/six-eleven/hulu/client)
- `video_metadata` includes `end_credits_time`, `markers`, `has_network_pre_roll` and `interstitials`, which presumably drive skip-intro, the next-episode card and network pre-rolls. — same source
- The request has an `ignore_kids_block` flag, so kids profiles can block content at the playlist level. — same source

### Inferences
- **[INFERENCE]** Every episode (including autoplay of the next one) needs its own `content_eab_id`, so the SPA must make a new playlist POST per episode even if the `<video>` element is reused. The extension should key its state on `content_eab_id` (or the /watch/<id> path) and on each new playlist response, not on page load. It should also clear the old cues when `location.pathname` changes or a new playlist arrives.
- **[INFERENCE]** The content playlist is probably fetched before or alongside pre-roll ads (the ad decision needs `breaks`). If the hook misses it (for example, the request came from a service worker or happened before document_start injection), fallback options are a second request (not recommended), waiting for `<track>` elements, or watching the player's rendered caption DOM.
- **[INFERENCE]** Trailers and previews go through the same playlist API with a different EAB id. The extension should ignore playlists whose `video_metadata.length` is short, or that don't match the current /watch id.

### Gaps
- No evidence on whether the playlist call happens in a Worker or service worker, which would hide it from MAIN-world fetch hooks.
- No documentation on SPA navigation behaviour or profile switching.

## 4. Hulu inside Disney+ (2025-2026)

### Takeaway
Disney said the standalone Hulu app would be retired in 2026 and Hulu content folded into Disney+. As of July 2026 Hulu still runs standalone, with no announced shutdown date for hulu.com. Disney+ web uses BAMTech HLS. Its master playlist lists subtitles as `#EXT-X-MEDIA TYPE=SUBTITLES GROUP-ID="sub-main"` with per-language segmented WebVTT playlists and `FORCED=YES` tracks.

### Cited Findings
- On 2025-12-30, outlets reported (citing Variety) that the standalone Hulu app would become unavailable sometime in 2026, with Hulu fully integrated into Disney+. No exact date was given, and Hulu + Live TV would also move into Disney+ in 2026. Hulu content began appearing in Disney+ in spring 2024. — [Western Mass News 2025-12-30](https://www.westernmassnews.com/2025/12/30/hulu-app-shut-down-2026-content-be-fully-integrated-with-disney); [AZFamily](https://www.azfamily.com/2025/12/30/hulu-app-shut-down-2026-content-be-fully-integrated-with-disney)
- In July 2026: "no current plans to sunset the Hulu app" per Disney, but an internal document says "The Hulu tech stack and app will be decommissioned after all users have transitioned." The reported internal target is end of 2026. No shutdown date has been announced for hulu.com, and Live TV still runs through the Hulu app. — [Hoodline, July 2026](https://hoodline.com/2026/07/hulu-s-not-dead-yet-but-disney-is-moving-in/) (secondary source citing leaked material)
- Disney+ playback (Subtitle-Downloader, 2024): `POST` to the media-service playback endpoint with headers `accept: application/vnd.media-service+json; version=6`, `x-bamsdk-platform`, `x-bamsdk-version`, `x-dss-edge-accept`, and a bearer `authorization`. The response gives `stream.sources[0].complete.url` (HLS master). The client picks the highest-bandwidth variant and reads its `media` with `type == 'SUBTITLES'` and `group_id == 'sub-main'`. When `FORCED == 'YES'` it appends `-forced` to the language code. It loads each subtitle media playlist and downloads every segment URI, all `.vtt`. Metadata comes from `disney.api.edge.bamgrid.com/explore/v1.2/...`. — [wayneclub/Subtitle-Downloader disneyplus.py](https://github.com/wayneclub/Subtitle-Downloader/blob/main/services/disneyplus/disneyplus.py)
- Subtitle-Downloader lists Disney+ outputs such as "English [CC]" and forced variants for es/fr/it/ja/ko/pl/pt. It does not support Hulu. — [Subtitle-Downloader README](https://github.com/wayneclub/Subtitle-Downloader)
- The "Disney+ Subtitles Downloader" userscript adds download buttons to the track picker on disneyplus.com, exports .srt, and can fetch forced subtitles. — [Greasy Fork #404223](https://greasyfork.org/en/scripts/404223-disney-subtitles-downloader) (details page returned 404 when fetched; description from search snippet)
- Forced narrative subtitles on Disney+ are a known user topic. — [AVForums thread](https://www.avforums.com/threads/forced-narrative-subtitles-on-disney.2547027/)
- HLS `FORCED=YES` marks renditions essential to playback, such as foreign-dialogue-only text. `CHARACTERISTICS` holds UTIs such as `public.accessibility.transcribes-spoken-dialog` / `describes-music-and-sound`, which mark CC/SDH. — [RFC 8216 §4.3.4.1](https://www.rfc-editor.org/rfc/rfc8216.html); [Mux blog on HLS subtitle flags](https://www.mux.com/blog/subtitles-captions-webvtt-hls-and-those-magic-flags)
- Disney+ offers subtitles/CC in up to 42 languages and grew to 58 audio languages in July 2026. — [Senal News 2026-07-17](https://senalnews.com/en/digital/disney-expands-platform-localization-with-support-for-58-audio-languages)
- Language Reactor still lacks Disney+ support (forum requests, no timeline). — [LLN forum](https://forum.languagelearningwithnetflix.com/t/please-add-support-for-dual-subtitles-on-disney-plus/43659)

### Inferences
- **[INFERENCE]** Hulu titles played on disneyplus.com almost certainly use the Disney+ (BAMTech) pipeline, not `play.hulu.com`. The extension's HLS master parser is the right path there. Choose the `sub-main` English rendition with `FORCED=NO`, preferring the one whose NAME has "[CC]" or whose CHARACTERISTICS include `transcribes-spoken-dialog`. Don't pick the forced track as "full English". The current manifest only declares `*.hulu.com`, so disneyplus.com needs its own match pattern and host permission.
- **[INFERENCE]** The Disney+ web player (BAMTech SDK) may do manifest fetches inside a Web Worker or via MSE helpers, so page fetch/XHR hooks may not see them. Fallbacks: `PerformanceObserver` (resource timing entries show `.m3u8` URLs even from the page context, but not from workers), or `chrome.webRequest` observation in the extension's service worker, which sees worker requests as well.
- **[INFERENCE]** Widevine DRM covers only audio/video segments. WebVTT subtitle segments are plain text, so reading them needs no DRM interaction.

### Gaps
- I found no 2026 source showing whether hulu.com/watch now redirects to disneyplus.com. As of July 2026 it reportedly did not.
- No source on Disney+ subtitle CDN host names in 2026, on CORS, or on whether manifest requests run in a worker.
- No source on the SDH vs CC naming that Disney+ uses for Hulu-originated titles.

## 5. Open-source code that handles these

### Takeaway
Open-source code that models the Hulu `transcripts_urls` structure exists (several Go clients, 2021-era). A Disney+ HLS `sub-main` parser exists in Subtitle-Downloader (2024). yt-dlp supports neither service.

### Cited Findings
- six-eleven/hulu (Go, 2021-12): config → deeplink → v6 playlist; `transcripts_urls` {smi, webvtt, ttml}. — [pkg.go.dev](https://pkg.go.dev/github.com/six-eleven/hulu/client)
- TheMegafuji/hulu and mojopix/hload: forks with the same `PlaylistRequest` / `transcripts_urls` structs. — [TheMegafuji](https://pkg.go.dev/github.com/TheMegafuji/hulu/hulu); [mojopix/hload](https://pkg.go.dev/github.com/mojopix/hload/client)
- wayneclub/Subtitle-Downloader (Python): Disney+ HLS sub-main, forced suffix, segmented vtt joined into srt. No Hulu module. Disney+ module last commit 2024-05-09. — [GitHub](https://github.com/wayneclub/Subtitle-Downloader)
- unshackle (successor to devine) has DSNP service plugins discussed on VideoHelp. Only forum snippets were available, no structure details. — [VideoHelp forum](https://forum.videohelp.com/showthread.php?p=2800244)
- Chrome Web Store has Hulu-specific subtitle extensions (Hulu Dual Subtitles, Hulu SubStyler, Hulu key C toggle). Implementation details aren't public. — [Hulu Dual Subtitles](https://chromewebstore.google.com/detail/llbekaiifiopdmojkacmkaihdenoffnh); [Hulu SubStyler](https://chrome.google.com/webstore/detail/hulu-substyler-customize/phkbeppdcipbpnhibendddhpfpgcjlmh)

### Gaps
- Couldn't read the current unshackle Hulu/DSNP service code (the mirror returned 404). No Immersive Translate technical notes on Hulu were found.

## 6. Corner cases checklist

### Takeaway
Most cases follow from the structures above. Few have direct sources, so most items are inferences to test.

### Cited Findings
- `video_metadata.has_captions` can be false. Not every title has captions. — [six-eleven/hulu](https://pkg.go.dev/github.com/six-eleven/hulu/client)
- `video_metadata.language` and `audio_tracks[].language` / `role` exist, so Spanish-original titles and secondary audio are modelled. — same source
- Disney+ has forced tracks per language (`FORCED=YES` → `-forced`). — [Subtitle-Downloader](https://github.com/wayneclub/Subtitle-Downloader/blob/main/services/disneyplus/disneyplus.py)
- WebVTT segments may contain no cues (empty segments are valid), and cues repeat across segment boundaries. — [FFmpeg trac #4048](https://trac.ffmpeg.org/ticket/4048)

### Inferences (checklist)
- **No English subs**: if `has_captions` is false or there's no `en*` key, show a clear "this title has no English captions" message instead of "link not found".
- **Multiple English tracks**: Hulu `transcripts_urls` probably has one per format and language. On Disney+, pick non-forced; prefer CC/SDH over plain if only those exist; ignore `-forced`.
- **Spanish-language titles**: the English track may be a full translation or forced-only. Check the cue count against the duration.
- **Language codes**: normalise `en`, `en-US`, `en-GB`, `eng`, `English`, and `English [CC]` (NAME attribute).
- **Kids profiles**: `ignore_kids_block` means the playlist may be refused. No subtitle-specific difference is known.
- **Long movies (>3 h)**: many segments on Disney+. Fetch with limited concurrency and retries; on Hulu it's a single file.
- **Late-starting subtitles**: the first cue may come minutes in. Don't call it "empty" unless the file has zero cues.
- **TTML**: if only TTML exists, handle `<p begin/end>` in clock, offset or tick time (`ttp:tickRate`), `<br/>`, `<span>` styles, regions, and `tts:` attributes. Ignore ruby.
- **SMI (SAMI)**: legacy fallback only. It's `<SYNC Start=ms>` HTML-ish, and an empty `&nbsp;` sync marks the end of a cue.
- **Live/sports**: no complete file. Mark unsupported.
- **CORS/credentials**: fetch caption URLs from the page context with `credentials: 'omit'` first, then retry from the extension's service worker with host permissions if CORS blocks it. Untested; no source on headers.
- **Expiring URLs**: re-parse each new playlist, and don't cache URLs across sessions.
- **Rate limiting**: no public info. Avoid making extra playlist requests and reuse the page's own responses.

### Gaps
- None of the corner-case behaviours above has been verified against live 2026 traffic. A DevTools HAR capture on hulu.com and on disneyplus.com (Hulu tile) is the recommended next step.
