# Smart Subtitles for Hulu

Watch Hulu and Disney+ with English subtitles and a translation in your language, together on screen. Also works with Hulu content inside Disney+.

Choose from 55 languages, adjust the subtitle size, or drag the subtitles to a comfortable position. Translations are saved on your computer for next time.

## Get started

You'll need Windows, Chrome, access to the videos you want to watch, and either a ChatGPT account with Codex access or your own Google Cloud Translation API key.

1. Download the Windows companion app from [Releases](https://github.com/jinzhou5042x/smart-subtitles-for-hulu/releases) and unzip it.
2. Double-click **Set Up Codex.cmd** and sign in to ChatGPT. You only need to do this once. Skip this step if you will use Google Translate.
3. Double-click **Start Subtitles.cmd**. Keep the app running while you watch.
4. Install the Chrome extension, open it, and enter the pairing code from the companion app.
5. Play a video on Hulu or Disney+ and choose your language in the extension.

Each English subtitle keeps its own translation and original timing. The app checks that the returned timestamps and English text match before saving. Only saved subtitles appear on screen. Progress is saved every minute of video time. The progress bar shows how much is ready. If interrupted, the app resumes from the last saved section.

## Use Google Translate

Choose **Google** under **Translator** in the extension. Paste your Google Cloud Translation API key and enter an absolute local path where you want to save it, then click **Save & use Google**. The folder must already exist. To use an existing key file, enter its path and leave the key field blank. Existing files are never overwritten.

Enable Cloud Translation API in your Google Cloud project first. Google may charge for API usage. The key stays in your chosen file; it is not saved in browser storage or sent to this project's servers. Newly created files are restricted to your Windows account. Existing files retain the permissions you manage. The file is plaintext, not encrypted.

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

[Report a problem](https://github.com/jinzhou5042x/smart-subtitles-for-hulu/issues) · [Developer guide](README-DEVELOPMENT.md)

Unofficial. Not affiliated with Hulu or Disney.
