# Translation Quality and Timing/Sync Complaints in Dual-Subtitle / AI Subtitle-Translation Tools

Scope note: about 18 tool calls. Primary sources reached: the Language Reactor community forum (forum.languagelearningwithnetflix.com), Firefox AMO reviews for Dualsub, the Immersive Translate GitHub issue tracker, the pyvideotrans support forum (Chinese), and Immersive Translate's own docs. I did not open Reddit threads, Chrome Web Store review pages, Trustpilot, V2EX, Zhihu or Xiaohongshu directly; search returned no usable Reddit threads for these queries. So the counts below are lower bounds from the threads I read, not market-wide frequencies.

## Translation quality: what goes wrong, how often, which tools

### Takeaway
The most-documented quality complaint is that full-sentence machine translation of subtitle lines is poor, especially for Japanese, a language where meaning depends heavily on context. Users say these translations are "virtually unusable" (Language Reactor). They also report words that are right in a single-word popup but wrong inside the translated sentence, and content that is left out. Several users say Google Translate or GPT gives better results than the built-in engine. A second group of problems comes from the source: when the source subtitle is already wrong (YouTube auto-captions) or badly segmented (ASR), the translation is wrong too.

### Cited Findings
- **Language Reactor, Japanese MT "virtually unusable" (2024).** HAMID_ALGHURABI (25 Jun 2024): "the machine translation is so inaccurate, it it virtually unusable." s1212z (5 Jul 2024): "the machine translations a very bad. I'd go as far as to say they should disable them entirely", and said poor translations "could do more harm than good" and should not be sold as a subscription feature. Users asked to be allowed to upload their own human SRT files or for a better engine. No staff reply appears in the thread. — [Machine Translation is incorrect](https://forum.languagelearningwithnetflix.com/t/machine-translation-is-incorrect/21342)
- **Context loss: word right in isolation, wrong in the sentence; parts left out; GPT/Google preferred (2024).** Codewolke (13 Jun 2024), studying Japanese song lyrics: "the machine translation is pretty bad and not suited to really understand the lyrics". Single words translate correctly in popups but not in the full sentence, and important content is skipped (one word was rendered as "broom" / "sledgehammer"). The user said "google translate or gpt give much better results." Bilingual input also breaks formatting: "the formatting is then completely broken and the system is very confused". — [Translation quality in "My Texts" is pretty low (Japanese -> English)](https://forum.languagelearningwithnetflix.com/t/translation-quality-in-my-texts-is-pretty-low-japanese-english/21127)
- **Errors come from the source subtitles (YouTube auto-captions), so the translation inherits them (2026).** Suribaci (21 Jan 2026): "Just looked at two videos on Youtube in Japanese and both times the first sentence has the wrong kanji." Example: 魚や貝が rendered as 魚屋絵画 (both read "sakanayakaiga"). Staff (22 Jan 2026): "Language Reactor does not generate subtitles for YouTube, but only provides translations… We use the subtitles that are already available on YouTube." — [Wrong translations on Youtube](https://forum.languagelearningwithnetflix.com/t/wrong-translations-on-youtube-how-to-deal-with-it/37586)
- **Translated line doesn't match the official native-language subtitle, seen as "more advanced" (2023).** Fabricio_Andree (6 Aug 2023) compared Netflix's own English subtitles with Language Reactor's: "extension subtitles go quite a bit advances and it does not match the subtitles of the video." No staff reply. — [The subtitles below don't match the ones above](https://forum.languagelearningwithnetflix.com/t/the-subtitles-below-dont-match-the-ones-above-they-are-too-advanced-aid/13551)
- **LLM batching breaks line alignment (Immersive Translate, Sep 2026).** Issue #4071 (Atomic1212, 19 Sep 2026): "The plugin puts multiple subtitle segments into a single request to the qwen mt model, separating each segment with `\n\n%%\n\n`. Sometimes the model's translation loses some of these separators, causing subtitle misalignment between source and target text." The user asked to "temporarily disable merging multiple subtitles into a single request." The issue was labelled enhancement and closed. — [GitHub #4071](https://github.com/immersive-translate/immersive-translate/issues/4071)
- **Other Immersive Translate subtitle issues (titles only, 2025-2026):** #4009 "中文字幕翻中文字幕" (Chinese subtitles translated into Chinese, i.e. wrong source-language detection); #3925 "canvas 站点字幕重复" (duplicate subtitles); #4067 "YouTube 字幕经常有莫名其妙的空格" (stray spaces in YouTube subtitles); #3919 "「优先使用人工字幕」失效" (the "prefer human subtitles" setting is ignored, so it falls back to ASR). A GitHub search for "字幕 翻译" returned 276 issues. — [immersive-translate issues search](https://github.com/immersive-translate/immersive-translate/issues?q=字幕+翻译)
- **Bad segmentation produces long run-on lines (pyvideotrans, a Chinese AI subtitle translator).** User: "翻译断句很差，开启了重新断句也没什么用，会连着一大断话" ("segmentation is poor; turning on re-segmentation doesn't help; lines run together into one big block"). The maintainer's reply blames the ASR/VAD step and suggests switching Whisper model or adjusting vad_threshold / max_line_length. Posted about 11 months before fetch (around late 2025). — [bbs.pyvideotrans.com/show/1196](https://bbs.pyvideotrans.com/show/1196)
- **Dualsub (Firefox): language support regressions rather than quality complaints.** Rating 4.2/5 from 125 reviews, with 18 one-star reviews. A T (Feb 2026): "Was the best Dual Subs App, now does not even translate Mandarin, always 'Unsupported source language'". — [AMO Dualsub reviews](https://addons.mozilla.org/en-US/firefox/addon/dualsub/reviews/?score=1)
- **Engine preference (secondary sources only):** an aggregator of Reddit opinion says DeepL is rated above Google and that "ChatGPT and Claude lead for idioms, context, and Asian languages", while DeepL leads for European languages. This is an aggregator, not primary, so treat it as weak. — [aitooldiscovery](https://www.aitooldiscovery.com/guides/best-translation-ai-reddit); [gummysearch](https://gummysearch.com/tools/best-products/translation-app/)
- **Developers' own framing of the split-sentence problem:** subtitle-translator projects reconstruct full sentences before translating and spread the output back across the original cues to keep timing. They warn that small local models "make it easier to cause chaotic translation results" and recommend GPT-4o-mini or larger. — [pyvideotrans AI translate docs](https://pyvideotrans.com/en/aitranslate); [subtitle-translator (gnehs)](https://www.sourcepulse.org/projects/1830556)

### Inferences
- Two root causes dominate: (1) translating each cue on its own without context, which mostly hurts Japanese and other context-heavy languages, and (2) translation inherits upstream errors from ASR or auto-captions. A tool that translates with whole-sentence or scene context and prefers human subtitle tracks addresses both.
- LLM translation brings a failure mode that Google and DeepL don't have: when cues are batched, the model can drop or merge delimiters and the lines shift relative to the source (#4071). This is the main LLM-specific quality risk users reported.

### Gaps
- No primary user quotes found on these sub-topics: character-name consistency, formality/gender/pronouns, sarcasm/profanity, SDH tags ([door slams]), song lyrics (beyond Codewolke). No Reddit threads were retrieved.
- No Trancy, eJOY, Lingopie, InterSub or Mate user reviews were reached. A Trancy search returned only its changelog, which admits to "instability", subtitle-loading problems on YouTube/Netflix/Disney+, and Netflix "garbled text" fixes ([Trancy changelog](https://www.trancy.org/changelog?page=2)).
- Chrome Web Store review counts and ratings were not collected.

## Timing / sync: drift, misalignment, merged and split lines

### Takeaway
Reported sync problems come from the translated track being split or aligned differently from the original. Long sentences get broken up differently, the extension times lines to the original-language track rather than the native one, LLM output gets misaligned, and ads shift the timeline. The largest thread found had at least 7 users reporting desync, but it dates from 2021.

### Cited Findings
- **Language Reactor (then "Language Learning with Netflix") YouTube desync, Aug 2021 (older, flagged).** At least 7 users in one thread: Sir_Isaac (4 Aug 2021) "the german translation and english translation is out of sync. Like way out of sync."; DannyP (30 Aug 2021) "It's wildly out of sync."; Jacob_M (10 Aug 2021) suspected "it has something to do with the way long sentences are broken up"; Vincent: "same desync whether the destination language is english or french". The developer said fixes had been applied (30 Aug 2021). — [Anyone having troubles with subtitles being out of sync? Youtube](https://forum.languagelearningwithnetflix.com/t/anyone-having-troubles-with-subtitles-being-out-of-sync-youtube/4892)
- **Timing anchored to the original-language track loses lines that exist only in the native track (Dec 2024).** atnaris: "the timing of Language Reactor subtitles is synced to the subtitle track of the media's original language rather than the user's native language". With the anime *Monster*, an on-screen Japanese prologue had English subtitles in the English track but showed nothing in Language Reactor. The fix that worked was switching to asbplayer: "asbplayer seems to be exactly what I was looking for." — [Sync subtitles to user's native language](https://forum.languagelearningwithnetflix.com/t/sync-subtitles-to-users-native-language-instead-of-medias-original-language/25672)
- **Ad breaks cause desync (Immersive Translate):** issue #3963 "字幕因插播广告导致视频字幕不同步" (subtitles go out of sync because of mid-roll ads). This matters for Hulu's ad-supported tier. — [immersive-translate issues](https://github.com/immersive-translate/immersive-translate/issues?q=字幕+翻译)
- **LLM delimiter loss shifts the target lines against the source:** see #4071 above. — [GitHub #4071](https://github.com/immersive-translate/immersive-translate/issues/4071)
- **AI-generated (ASR) subtitles out of sync with audio (pyvideotrans):** "使用转录并翻译字幕功能(无配音)时,生成出的中英字幕与原始视频声音画面不同步,差别太远" (with transcribe-and-translate, the generated Chinese-English subtitles are far out of sync with the audio). The support answer blames imprecise ASR/VAD timestamps. — [bbs.pyvideotrans.com/show/6078](https://bbs.pyvideotrans.com/show/6078); see also [#2481](https://bbs.pyvideotrans.com/show/2481)

### Inferences
- Users notice when the translated line doesn't correspond one-to-one with the original cue. Keeping cue boundaries 1:1 with the source track, and handling sentences that span several cues without merging or shifting them, is the main sync requirement.
- On ad-supported streams (Hulu), ad insertion is a known cause of desync in a competitor.

### Gaps
- No recent (2025-2026) user reports found of drift over an episode or mismatch after seeking for Netflix/Hulu/Disney+ extensions. No flicker complaints found.

## Delay before translated subtitles appear, partial translation, translation stopping

### Takeaway
"Translation doesn't appear / stuck loading" is a recurring kind of complaint, and it often has an external cause (Netflix A/B tests, YouTube 429 rate limits, server outages). I found no quantified first-line latency complaints.

### Cited Findings
- **Language Reactor Pro AI translation not showing (Aug 2026).** airsquirrel1204 (10 Aug 2026): "subtitles themselves display correctly, but there is a problem where AI translation does not run or the translation results are not shown"; hottawa (12 Aug 2026): "AI translation is not showing up at all". Staff blamed a Netflix A/B test, and opting out fixed it. — [AI Translation Not Working (LR Pro)](https://forum.languagelearningwithnetflix.com/t/ai-translation-not-working-on-youtube-and-netflix-language-reactor-pro/43836)
- **Other LR threads, titles only (not opened):** "Language Reactor gets stuck on 'Loading…'", "Language Reactor Not Working Server Issue", "Translations not loading when using Media section". — [forum](https://forum.languagelearningwithnetflix.com/t/language-reactor-gets-stuck-on-loading/40501), [forum](https://forum.languagelearningwithnetflix.com/t/language-reactor-not-working-server-issue/36941), [forum](https://forum.languagelearningwithnetflix.com/t/translations-not-loading-when-using-media-section-of-language-reactor/32079)
- **YouTube 429 rate limit (Immersive Translate docs):** YouTube's machine-translated subtitle endpoint gets rate-limited when users change languages quickly, open many videos, or share a VPN or campus network. Immersive Translate now falls back to fetching the original track and translating it with the user's own engine. — [Immersive Translate: youtube subtitle 429](https://immersivetranslate.com/docs/youtube-subtitle-429/)
- **Dualsub:** search snippets mention "server response delays and quota limitations" in reviews, but I did not verify the wording on the review page. — [firefox-stats Dualsub reviews](https://firefox-stats.com/d/dualsub/reviews)

### Inferences
- Users experience a silent failure (original shows, translation never appears) as "broken". A visible progress or error state would set the product apart. The current repo commit "Show translation progress… in the popup" fits this.

### Gaps
- No user-reported latency figures (seconds to first translated line) found.

## LLM/GPT-specific complaints (cost, speed, rate limits, quality vs Google/DeepL)

### Takeaway
I found little primary evidence. The one concrete LLM-specific defect is batch delimiter loss causing misalignment (#4071). Users who compare engines say GPT or Google beats Language Reactor's built-in MT for Japanese.

### Cited Findings
- Qwen-MT batch delimiter loss causes misaligned lines. — [GitHub #4071](https://github.com/immersive-translate/immersive-translate/issues/4071)
- "google translate or gpt give much better results" (Japanese lyrics, Jun 2024). — [LR forum](https://forum.languagelearningwithnetflix.com/t/translation-quality-in-my-texts-is-pretty-low-japanese-english/21127)
- Developer docs warn that small or local models produce "chaotic" output when they translate whole subtitle files. — [pyvideotrans](https://pyvideotrans.com/en/aitranslate)

### Inferences
- Batching is needed for speed and cost but creates an alignment risk. Validating the returned line count, or using structured (JSON/ID-keyed) output, is the obvious mitigation.

### Gaps
- No primary user complaints found about per-episode cost, API rate limits (429s from OpenAI or similar), or LLM speed in subtitle extensions. Reddit, Chrome Web Store, V2EX and Xiaohongshu would be the next places to look.
