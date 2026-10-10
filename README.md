# Smart Subtitles

Watch Hulu and Disney+ with English subtitles and a translation in your language, together on screen. Also works with Hulu content inside Disney+.

Choose from 55 languages, adjust the subtitle size, or drag the subtitles to a comfortable position. Translations are saved on your computer for next time.

## Get started

You'll need Windows or macOS 13+, Chrome 127+, access to the videos you want to watch, and either a ChatGPT account with Codex access or your own Google Cloud Translation API key.

1. Download the companion app for your platform (Windows x64, macOS Apple Silicon/arm64, or macOS Intel/x64) from [Releases](https://github.com/jinzhou5042x/smart-subtitles-for-hulu/releases) and unzip it.

2. Double-click **Set Up Codex.cmd** (Windows) or **Set Up Codex.command** (Mac) and sign in to ChatGPT. You only need to do this once. Skip this step if you will use Google Translate.

3. Double-click **Start Subtitles.cmd** (Windows) or **Start Subtitles.command** (Mac). Keep the app running while you watch.

4. Install the Chrome extension, open it, and enter the pairing code from the companion app.

5. Play a video on Hulu or Disney+ and choose your language in the extension.

Each English subtitle keeps its own translation and original timing. The app checks that the returned timestamps and English text match before saving. Only saved subtitles appear on screen. Progress is saved every minute of video time. The progress bar shows how much is ready. If interrupted, the app resumes from the last saved section.

## macOS Chrome setup

For a source checkout, install Node.js 22.13 or later, then double-click **Set Up Codex.command** and **Start Subtitles.command**. The start launcher builds `dist/extension`; open `chrome://extensions`, enable Developer mode, and load that folder. Release packages bundle Node and the native file picker, so they do not require developer tools. Choose the release matching your Mac's processor.

Use **Stop Subtitles.command** to stop the background service and **Check Environment.command** for diagnostics. You can close the Terminal window after startup. Keep the extracted folder in a permanent, writable location. If macOS blocks a downloaded launcher, review the source and allow it using Finder's Open action or System Settings → Privacy & Security.

The Mac companion supports Codex, Google key-file selection, pairing, local caching and the same Chrome subtitle controls. Source checkouts need Xcode Command Line Tools to compile the native picker on first use. Actual Hulu/Disney+ playback on Mac still needs account-based verification.

## Use Google Translate

Choose **Google** under **Translator**, then click **Link API key file...** and select your existing key file in the native file picker. The selected path becomes the link. To switch files, click that path; cancelling the picker keeps the current key. Leading and trailing whitespace (spaces, tabs, CR/LF and UTF-8 BOM) is stripped when reading the key; the file itself is unchanged. Your last Translator selection is remembered.

Enable Cloud Translation API in your Google Cloud project first. Google may charge for API usage. The key stays in your chosen file; it is not saved in browser storage or sent to this project's servers. Newly created files are restricted to your user account. Existing files retain the permissions you manage. The file is plaintext, not encrypted.

## While watching

- **Change the language or size:** open the extension. Drag the subtitles on the video to move them.

- **Watch again:** saved translations load automatically. Choosing a new language starts a separate translation.

- **After an ad:** subtitles stay hidden during the break. The extension requests fresh player timing afterward and automatically resyncs when it becomes available.

- **See a sync prompt on Disney+:** move your pointer over the video or pause once.

- **After an extension update:** reload the extension and refresh the video page.

Videos need English subtitles. Live TV isn't supported. Ad recovery has automated test coverage; real ad-supported playback still needs verification.

## Your data

The extension is free to use. Subtitle text goes directly from your computer to the translation service you use; it does not pass through servers operated by this project. Subtitle files and saved translations are stored locally.

Codex uses your own ChatGPT login and allowance. Optional Google translation uses your own API key, stored in a file at a path you choose. Account or API charges from those services are separate; the plugin does not collect a translation fee. This is not an offline-only app. See the [developer guide](README-DEVELOPMENT.md#your-api-key) for key-file setup. See [Terms & Privacy](https://jinzhou5042x.github.io/smart-subtitles-for-hulu/).

[Report a problem](https://github.com/jinzhou5042x/smart-subtitles-for-hulu/issues) Â· [Developer guide](README-DEVELOPMENT.md)

Unofficial. Not affiliated with Hulu or Disney.
