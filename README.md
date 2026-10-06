# Smart Subtitles for Hulu

Bilingual subtitles on Hulu: the original English subtitles with a natural, in-context translation into one of 55 languages, shown right over the player.

- **55 languages**, translated from English
- **Natural translation**: slang, sarcasm and idioms are translated by meaning, not word for word
- **Perfect timing**: every translation uses the timing of the original subtitle
- Finished titles are saved on your computer and load instantly next time; drag the subtitles up or down and choose their size

## Install (Windows)

1. **Companion app**: download `SmartSubtitlesForHulu-Service-<version>-win-x64.zip` from [Releases](https://github.com/jinzhou5042x/smart-subtitles-for-hulu/releases) and unzip it somewhere permanent. Optionally check the download against the `.sha256.txt` file next to it.
2. Double-click **Set Up Codex.cmd** (once). It uses Codex if it is installed, otherwise installs the official Codex CLI into the app folder, then opens the ChatGPT sign-in. A ChatGPT account with Codex access is required.
3. Double-click **Start Subtitles.cmd** and copy the pairing code it shows.
4. Install the **Chrome extension**, click its icon, paste the pairing code and click Connect.
5. Open a Hulu video with English subtitles and pick your language.

## How it works

The extension reads the English subtitles the Hulu player already loads and sends them to the companion app on your own computer (`127.0.0.1` only, protected by the pairing code). The app translates them with Codex through your own ChatGPT sign-in and stores finished translations in a local database. There is no server of ours, no account and no tracking. See the [Terms of Use and Privacy Policy](https://jinzhou5042x.github.io/smart-subtitles-for-hulu/).

Developers: see [README-DEVELOPMENT.md](README-DEVELOPMENT.md). `npm test` runs the tests; `npm run package` builds the Chrome Web Store zip; `npm run release` builds the Windows companion app.

---

Unofficial tool. Not affiliated with, endorsed by or sponsored by Hulu, LLC or The Walt Disney Company. "Hulu" is a trademark of its owner and is used only to describe compatibility. Provided as is, without warranty, for personal, non-commercial use.
