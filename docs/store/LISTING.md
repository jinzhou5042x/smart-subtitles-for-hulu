# Chrome Web Store submission

Everything to paste into the Developer Dashboard for **Smart Subtitles for Hulu**.
Upload: `dist/store/smart-subtitles-for-hulu-<version>.zip` (`npm run package`).
Images: `dist/store/assets/` (`node scripts/store-assets.mjs`).

## Store listing tab

**Name** (from the manifest): Smart Subtitles for Hulu

**Summary** (from the manifest, max 132 characters):
Bilingual AI subtitles for Hulu videos. Unofficial; not affiliated with Hulu.

**Description:**

```
Smart Subtitles for Hulu shows the original English subtitles of a Hulu video together with a natural translation into your language, right over the player.

• English to 55 languages, including Chinese, Spanish, Japanese, Korean, French, German and Portuguese.
• Translated in context: slang, sarcasm and idioms are translated by meaning, not word for word.
• Exact timing: every translation uses the timing of the original subtitle.
• Subtitles appear within seconds; finished titles are saved on your computer and load instantly next time.
• Drag the subtitles up or down, and choose their size.
• Choose your translator: Codex (with your own ChatGPT sign-in), Google Cloud Translation (with your own API key), or a translation model running entirely on your computer.

REQUIRES THE COMPANION APP
Translation runs in a small companion service on your Windows computer, which the extension talks to locally. Install and start it first, then enter the pairing code it shows into the extension. Subtitles are never sent to the developer.

PRIVACY
No accounts, no analytics, no tracking. Subtitles go only to the companion service on your computer and, if you choose Codex or Google, to that provider. See the Terms of Use and Privacy Policy.

DISCLAIMER
Unofficial tool. Not affiliated with, endorsed by or sponsored by Hulu, LLC or The Walt Disney Company. "Hulu" is a trademark of its owner and is used only to describe compatibility. For personal, non-commercial use.
```

**Category:** Accessibility (alternative: Tools)
**Language:** English
**Store icon:** `extension/icons/icon-128.png`
**Screenshots (1280x800):** `screenshot-1.png`, `screenshot-2.png`
**Small promo tile (440x280):** `promo-440x280.png`
**Homepage / support URL:** https://github.com/jinzhou5042x/smart-subtitles-for-hulu

## Privacy practices tab

**Single purpose:**
Show bilingual subtitles over Hulu videos by translating the video's existing English subtitles into the language the user chooses.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings (on/off, target language, translator, subtitle size and position) and the pairing code of the companion service. |
| `activeTab` | When the user changes a setting in the popup, the new setting is applied immediately to the Hulu tab they are watching. |
| Host permission `http://127.0.0.1/*` | The extension sends subtitles to the companion translation service running on the user's own computer (localhost only), authenticated with a pairing code. |
| Content scripts on `hulu.com` | Read the subtitle files the Hulu player already loads for the current video, and draw the translated subtitles over the player. The extension runs on no other website. |

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension.

**Data usage** — check only:
- ✅ **Website content** (the subtitle text and timing of the video being watched).

Leave every other category (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity) unchecked.

**Certify all three:**
- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ✅ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://jinzhou5042x.github.io/smart-subtitles-for-hulu/

## Distribution tab

**Visibility:** start with **Unlisted** (installable only through the link). Switch to Public later if wanted.
**Regions:** all regions where Hulu is available, or all regions.

## Notes for the reviewer (if the dashboard asks for test instructions)

```
This extension needs its companion service, which runs locally on Windows and performs the translation (it talks to the extension only through http://127.0.0.1:43127 with a pairing code). Without it, the popup shows "Enter the pairing code shown when you run Start Subtitles.cmd" and nothing is sent anywhere.

To test: install and start the companion app from the homepage, paste the pairing code into the popup, open any Hulu video with English subtitles available, and choose a target language. Translated subtitles appear above the original English line.

The extension does not download video, does not circumvent copy protection and only reads subtitle files the Hulu player already loads. It is unofficial and states so in its name, description and popup.
```

## Hosting the privacy policy

The page is published from https://github.com/jinzhou5042x/smart-subtitles-for-hulu (`index.html` = `extension/legal.html`) with GitHub Pages at https://jinzhou5042x.github.io/smart-subtitles-for-hulu/. After changing `extension/legal.html`, copy it to that repository as `index.html` and push.

## Before every release

1. `npm test`
2. `npm run bump -- <version>` (package.json and extension/manifest.json; everything else reads them).
3. `npm run package` and `node scripts/store-assets.mjs`
4. Upload the new zip under **Package → Upload new package**, then submit for review.
