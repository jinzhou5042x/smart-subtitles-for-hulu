# Hulu-specific dual-subtitle needs, setup friction, pricing/limits and privacy concerns

Research date: 2026-10-05. Method: web search plus page fetches. Reddit pages could not be fetched directly in this session, so **no verbatim Reddit quotes are included**. Treat this as a gap, not as evidence that the complaints do not exist. All quotes below come from pages that were actually fetched. The search-engine summaries are labeled as such.

## 1. Hulu: which tools support it, how well, and what Hulu viewers want

### Takeaway
None of the big dual-subtitle tools (Language Reactor, Trancy, Immersive Translate's video mode) lists Hulu as a supported platform. Hulu support comes from a few tiny, single-purpose Chrome extensions with about 500-700 users and roughly 5 ratings each. Their reviews mention timing delays and "does nothing". Hulu itself has no built-in two-language mode. The standalone Hulu app is being folded into Disney+ during 2026, so any Hulu-only DOM/player integration is fragile.

### Cited Findings
- **Language Reactor:** sources describe its supported platforms as Netflix, YouTube, Disney+ and Amazon Prime Video. Hulu is not mentioned. ([Wikipedia: Language Reactor](https://en.wikipedia.org/wiki/Language_Reactor), as summarized by the search engine.) A user forum thread exists titled "please add support for dual subtitles on disney plus". Requests for more platforms are a recurring theme. ([LR forum](https://forum.languagelearningwithnetflix.com/t/please-add-support-for-dual-subtitles-on-disney-plus/43659))
- **Trancy:** the pricing page lists free "Smart bilingual subtitles for YouTube, Netflix, HBO, Disney+, and other platforms". Hulu is not named. ([trancy.org/pricing](https://trancy.org/pricing)) Its manual lists YouTube, Netflix, Disney+, Udemy, Coursera, TED, edX and HBO Max. ([Trancy manual](https://manual.trancy.org/en/overview/about-trancy), via search summary)
- **Dualsub:** a search summary claimed Dualsub "supports 23 services, including HBO Max, Hulu, and Disney+, at varying levels of support". However, the Dualsub homepage I fetched only says "Translate and display dual subtitles on YouTube and other video websites" and does not name Hulu. **Unverified.** ([dualsub.xyz](https://www.dualsub.xyz/))
- **FluentAI:** has a public feature-request card titled "Addition of Hulu support". This shows unmet demand. ([FluentAI featurebase](https://fluentai.featurebase.app/p/addition-of-hulu-support))
- **"Hulu Dual Subtitles - Subtitle Translator" (Chrome):** 4.0 stars from 5 ratings, 724 users. Reviews include:
  - Caleb Morris (Dec 11, 2024): "Did everything it said it would, i was even able to turn off the english subtitles and keep the foreign language I wanted to watch. I'd recommend :)"
  - Xu Yingze (Mar 5, 2026): "How to customize subtitles?" This signals that customization is hard to discover.
  - [CWS reviews](https://chromewebstore.google.com/detail/hulu-dual-subtitles-subti/llbekaiifiopdmojkacmkaihdenoffnh/reviews)
- **"Double Subtitles for Hulu by MovieLingo" (Chrome):** 4.0 stars from 5 ratings, 541 users. Reviews include:
  - D R (Oct 30, 2025, 4★): "Works well, but the subtitles in this extension occasionally come delayed compared to the original Hulu subtitles.. Fix it if possible". The developer replied: "Unfortunately, this can happen, during faster dialogues, a delay may occur."
  - K_ Den_Night (Feb 8, 2024, 1★): "does nothing"
  - [CWS reviews](https://chromewebstore.google.com/detail/double-subtitles-for-hulu/ncjcogonjpcdebfhmbgjiiikealfgjco/reviews)
- **Japan-focused Hulu extensions:** a 2026 guide lists two of them, "Hulu 同時字幕で英語学習" (v2.5.0, updated Mar 23, 2026) and "日英同時字幕 for Hulu" (v1.0.1, Jan 14, 2026). The second works "when both tracks exist". The guide's caveats:
  - "a store listing proves that the extension is listed and what its publisher claims—not that it will work perfectly with your Hulu account, title, region, browser build, or tonight's player code."
  - "Hulu's current help documents captions and subtitles, but not a standard built-in simultaneous two-language mode."
  - "compatibility has an expiration date."
  - [Funfluen guide, published May 27, 2026 / updated Aug 20, 2026](https://funfluen.com/learn/guides/hulu-dual-subtitles-extension-what-works-for-language-learners/)
- **Desktop-only limit:** the same guide says "Chrome extensions can only be used on computers, not mobile devices". Extension workarounds do not reach the iPhone, Android or smart-TV Hulu apps. ([Funfluen](https://funfluen.com/learn/guides/hulu-dual-subtitles-extension-what-works-for-language-learners/))
- **Hulu's own subtitle tracks are thin:** an aggregator page says "subtitles are frequently an afterthought, with some titles shipping with multiple subtitle languages while others arrive with none". It also says Spanish subtitles are not attached to every episode because content providers decide which tracks exist. This is a low-quality aggregator source and should be checked against Hulu Help. ([search summary of cloud.motorsport.unibo.it article](https://cloud.motorsport.unibo.it/article/how-to-change-subtitle-language-on-hulu-a-step-by-step-mastery))
- **Older items:**
  - TechRadar compared subtitles across Netflix, Amazon, Hulu and Disney+. Undated in search results and likely 2020-2021. ([TechRadar](https://www.techradar.com/news/subtitles-tv-streaming-service-netflix-amazon-hulu-disney-plus))
  - The *Parasite* Hulu launch drew complaints about subtitle availability. 2020, old. ([MEAWW](https://meaww.com/hulu-parasite-twitter-sparks-massive-blowup-fans-english-subtitle))
- **Sync problems:** an article on Hulu subtitles going out of sync blames app bugs and connectivity. It suggests toggling captions off and on. ([Sportskeeda](https://sportskeeda.com/us/shows/how-fix-subtitles-sync-hulu-causes-fixes-explored))
- **Hulu-into-Disney+ migration:**
  - "Hulu and all its content have been fully integrated into the Disney+ app, and the stand-alone Hulu app will become unavailable sometime in 2026." The exact date had not been announced at the time. ([WLOX/Gray TV, Dec 30, 2025](https://www.wlox.com/2025/12/30/hulu-app-shut-down-2026-content-be-fully-integrated-with-disney))
  - Hulu + Live TV "will also be integrated into Disney+ sometime in 2026". Disney's sign-up page showed the Disney+/Hulu bundle as the most basic plan. (same source; [exchange4media](https://www.exchange4media.com/digital-news/disney-to-retire-hulu-app-in-2026-fully-merge-service-into-disney-146318.html))

### Inferences
- Hulu is underserved. The incumbents skip it, and the Hulu-only extensions have tiny install bases with "works / sometimes delayed / does nothing" reviews. A reliable Hulu dual-subtitle tool faces little direct competition.
- The Disney+ migration is the main platform risk. Hulu titles watched inside Disney+ (disneyplus.com) may need a Disney+ player integration. A tool that supports both hulu.com and Hulu-in-Disney+ would be future-proof. Check whether hulu.com web playback still works in late 2026.
- Translating subtitles (rather than pairing two existing tracks) matters on Hulu, because many titles only carry English (and sometimes Spanish) tracks. "When both tracks exist" tools like 日英同時字幕 for Hulu are limited by this.
- Subtitle timing lag is the only concrete quality complaint seen on Hulu tools. Low-latency or pre-fetched translation that stays aligned to Hulu cue timing is a differentiator.

### Gaps
- I found no verbatim r/Hulu threads about caption bugs from 2025-2026, because Reddit could not be fetched. Hulu Help's captions article returned empty, so the official list of subtitle languages is unconfirmed.
- Dualsub's Hulu support level and eJOY's Hulu support could not be confirmed.
- Not checked: whether hulu.com in a desktop browser now redirects to disneyplus.com, and the exact 2026 shutdown date.

## 2. Setup friction, pricing, paywalls, limits and BYO-API-key costs

### Takeaway
Market prices cluster at about $4-10/month. AI translation is gated behind token or "videos/day" quotas. Bring-your-own-key costs are tiny per film: cents per movie in vendor estimates. The friction is in setup (provider → key → model ID), not in cost. All of these tools are desktop-browser only.

### Cited Findings
- **Trancy:** has a free tier (bilingual subtitles, unlimited word translation, 100 word bookmarks, 50 PDF pages/month) and two paid tiers. ([trancy.org/pricing](https://trancy.org/pricing))
  - Premium: YouTube AI transcription 40 videos/day.
  - Premium + Advanced AI: 60/day, GPT-4.1 mini / DeepSeek V4 / Claude 4.5 Haiku / Gemini 3.0 Flash, and "20 million tokens monthly".
  - The page showed a "35% limited-time discount (ends October 15, 2026)".
  - App Store prices: monthly $3.99 and "Premium + AI yearly" $73.99 (via search summary of [App Store listing](https://apps.apple.com/app/id6475022743)).
  - AI Subtitle (Whisper) is "YouTube-only". ([Trancy manual](https://manual.trancy.org/en/billing-and-plans/premium), via search summary)
- **Immersive Translate Pro:** $4.90/month billed annually ($58.79/year) or $9.99 monthly, with a "20 million monthly token" allowance and use on up to 8 devices. Apple pricing: $9.99/month, $79.99/year. These figures come from search summaries citing the [App Store listing](https://apps.apple.com/app/immersive-translate/id6447957425) and [membership terms](https://immersivetranslate.com/ja/docs/MEMBERSHIP-TERMS/). The official pricing page did not render its table in my fetch. **Verify before quoting.**
- **Language Reactor Pro:**
  - MezzoGuild: "$5 per month for Pro". It also complains of an "Overwhelming and confusing interface", "slow or inactive development", and calls the chatbot "a complete waste of time". ([MezzoGuild review](https://www.mezzoguild.com/language-reactor-review/))
  - Other reviews report about $9/month billed monthly, or about $5/month billed annually. Figures vary between $5 and $7.99 across sources. **Conflicting.** ([Linglass](https://linglass.app/blog/linglass-vs-language-reactor), [TubeVocab](https://www.tubevocab.com/blog/en/language-reactor-review), via search summary)
- **Paywall backlash (Immersive Translate, 2025):** the team announced it would block unauthenticated third-party translation APIs, citing "data security protection". The community saw this as commercially motivated. The team later apologized, attributing the decision to "anxiety under growth pressure". ([StableLearn](https://stable-learn.com/en/immersive-translate-2025-security-incident/)) The same controversy also covered "forcing subscription memberships". ([search summary of StableLearn/ChainCatcher](https://www.chaincatcher.com/en/article/2196306))
- **BYO-key cost per movie:** DualPiP's guide (May 25, 2026) estimates a full 2-hour film at:
  - "approximately $0.03–0.07" with DeepSeek V4 Flash
  - "approximately $0.05–0.15" with GPT-4.1 mini
  - roughly 10-20x more with Claude Sonnet 4.6
  - [rabbitpair.com DualPiP guide](https://www.rabbitpair.com/en/blog/dualpip-ai-subtitle-translation-byok-guide)
  - These are vendor estimates, not independent measurements.
- **BYO-key setup is a three-step flow:** Add Provider → enter API key → Add Model (type a model ID such as "deepseek-v4-flash", optionally disable thinking mode) → select service. ([DualPiP guide](https://www.rabbitpair.com/en/blog/dualpip-ai-subtitle-translation-byok-guide))
- **API usage can spike:** an older Substack piece warns that Whisper/API usage "can blow out your API limits". ([Networked substack](https://networked.substack.com/p/careless-whisper-usage-can-blow-out))
- **Device limits:** extensions don't work on phones, tablets or TVs ([Funfluen](https://funfluen.com/learn/guides/hulu-dual-subtitles-extension-what-works-for-language-learners/)). A user forum thread asks whether Language Reactor can be used on Google TV ([LR forum](https://forum.languagelearningwithnetflix.com/t/is-possible-useis-it-possible-to-use-the-language-reactor-on-a-google-tv/14834)).

### Inferences
- Paying for an existing subscription account (for example a ChatGPT/Codex sign-in) avoids two problems: per-token billing anxiety and key setup. This is attractive, because the main BYO-key pain is configuration (model IDs, keys), not cost.
- At cents per movie, a subscription at $5-10/month that limits Hulu or AI translation would look poor value next to BYO-key. Tools that put basic dual subtitles behind a paywall (Immersive's API restriction) triggered backlash.
- Showing estimated tokens or cost per episode up front would directly address billing anxiety.

### Gaps
- I found no verbatim Reddit or Chrome Web Store quotes complaining specifically about API-key confusion or cost per episode. Reddit was unavailable.
- I found nothing on eJOY or Dualsub pricing, and nothing on how users react to "sign in with ChatGPT" or local-LLM approaches.

## 3. Privacy, security and data concerns

### Takeaway
Translation extensions rank among the most privileged Chrome extensions: they can read and change all sites. Their "we don't collect data" claims cannot be verified. Immersive Translate had a real 2025 leak of user content through public cloud storage. Local storage of keys and direct-to-provider requests are emerging selling points.

### Cited Findings
- **Incogni / Help Net Security report (Jan 28, 2026):**
  - Google Translate, eJOY AI Dictionary and Immersive Translate "scored high on potential impact because they required permissions that allowed them to read and change content across websites".
  - "Risk likelihood scores for translators remained low". Claims of no data collection "rely on developer disclosures and cannot be verified without access to the source code."
  - [Help Net Security](https://www.helpnetsecurity.com/2026/01/28/incogni-chrome-extensions-privacy-risks-report/)
- **Immersive Translate leak (around Aug 10, 2025):** the "webpage snapshot" feature uploaded HTML to Tencent Cloud COS with public access and no authentication. "These links may be indexed by search engine crawlers, leading to complete data exposure."
  - Exposed data reportedly included ID numbers, addresses, resumes, contracts, financial statements, crypto mnemonics and API keys.
  - Critics said the apology showed "insufficient attention to the technical causes and remedial measures."
  - [StableLearn](https://stable-learn.com/en/immersive-translate-2025-security-incident/); [ChainCatcher](https://www.chaincatcher.com/en/article/2196306); [Sinokap](https://it-support-china.com/immersive-translate-plugin-hit-by-major-security-flaw/)
- **Immersive Translate's current claims:** it now markets ISO 27001/27701 certification, GDPR compliance and "privacy-first design" ([immersivetranslate.com pricing page](https://immersivetranslate.com/en/pricing/)). It claims "zero content retention" and that no data is used for training ([privacy policy](https://immersivetranslate.com/docs/PRIVACY/), via search summary).
- **Language Reactor:** its Chrome Web Store privacy disclosure says it handles personally identifiable information, and that data is not sold or used for unrelated purposes. ([CWS privacy tab](https://chromewebstore.google.com/detail/hoombieeljmmljlkjmnheibnpciblicm/privacy), via search summary)
- **BYO-key as a privacy pitch:** DualPiP says it "stores API keys locally in browser storage and routes requests directly to your chosen provider with no intermediary servers involved." ([DualPiP guide](https://www.rabbitpair.com/en/blog/dualpip-ai-subtitle-translation-byok-guide))
- **Small-publisher risk:** "Hulu Dual Subtitles - Subtitle Translator" lists a personal email address as its developer support contact (via search summary of the [CWS listing](https://chromewebstore.google.com/detail/hulu-dual-subtitles-subti/llbekaiifiopdmojkacmkaihdenoffnh?hl=en)). Users have little basis for trust.

### Inferences
- Several things would separate a Hulu tool from Immersive Translate and anonymous Hulu extensions:
  - Host permissions limited to Hulu (and Disney+) domains, not all sites.
  - No developer server in the path.
  - Open source code.
  - Keys and tokens kept local.
- The Immersive 2025 incident, a Chinese-company product storing data on Tencent Cloud, is the concrete example behind "trust in Chinese-owned extensions" worries. I did not find a direct user quote framing it that way.

### Gaps
- I found no verbatim r/privacy or HN quotes about subtitle extensions, and no user sentiment on local or offline LLM subtitle translation. The tools ran out before I could collect these.
- The exact Chrome permission strings for the Hulu-specific extensions were not retrieved, because chrome-stats returned 403.
