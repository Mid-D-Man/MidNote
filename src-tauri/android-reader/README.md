<!-- Brought to u by MidManStudio -->
# MidNote background read-aloud

Read aloud that **keeps going with the screen off or the app in the background**, with a **media notification** in the
pull-down shade and on the lock screen: the note's title, *previous*, *pause / play*, *next*, *stop*, and a progress bar.

## Why a service

When the app goes to the background Android pauses the WebView (Tauri's `WryActivity.onPause` calls `webView.onPause()`), so
a reading loop written in JavaScript stalls, and the TTS plugin's events did not always reach the page even in the foreground.
So the whole reading is handed to a **foreground service** (type `mediaPlayback`), which owns Android's `TextToSpeech`, the
sentence-by-sentence loop, audio focus, a CPU wake lock while it speaks, a `MediaSession` and the notification. The page only
sends commands and shows what the service reports.

## Files

| File | What it is |
| --- | --- |
| `kotlin/ReaderCore.kt` | The reading state machine (idle / starting / reading / paused / done, look-ahead, generation numbers). **No Android classes**: tested on a plain JVM. |
| `kotlin/ReaderWire.kt` | How page and service talk: the piece separator (U+001E), number parsing, JSON text for events. Also plain JVM. |
| `kotlin/ReaderService.kt` | The foreground service: TextToSpeech, MediaSession, notification, audio focus, wake lock, headphones-unplugged. |
| `kotlin/ReaderBridge.kt` | `window.MidNoteReader` for the page (`@JavascriptInterface`), and `ReaderHub` (state shared with the service, events to the page). |
| `res/drawable/midnote_reader_small.xml` | The notification's small icon. |
| `install.py` | Adds all of this to the generated Android project (see below). |
| `test_install.py` | Tests for `install.py`. |
| `test/ReaderCoreTest.kt` | Tests for `ReaderCore.kt` and `ReaderWire.kt`. |

The page side is `src/lib/utils/nativeReader.ts` (bridge wrapper, event parser, `NativeReadAloud`) and
`src/lib/stores/readAloud.svelte.ts`, which uses the service when `window.MidNoteReader` exists and the TTS plugin
(`readAloudController.ts`) otherwise (browser, desktop, an older build).

## How it gets into the app

`src-tauri/gen/android` is NOT committed: the workflow writes it fresh. The step **Add the background read-aloud** in
`.github/workflows/build-andriod.yml` runs `install.py`, which

1. copies `kotlin/*.kt` next to `MainActivity.kt` (package line rewritten to match) and `res/` into the project,
2. checks that every `R.drawable` the Kotlin uses exists,
3. adds `onWebViewCreate` to `MainActivity.kt` (it gives the WebView to `ReaderBridge`),
4. adds the permissions `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK` and the `<service>`
   (`foregroundServiceType="mediaPlayback"`, required from Android 14) to the manifest,
5. checks its own work. On any problem it puts back every file it changed and exits; the step is `continue-on-error`, so the
   app still builds, without background reading, and **Check read-aloud in the build** shows a warning.

## How a reading runs

* The page cuts the note into sentence-sized pieces and calls `MidNoteReader.start(...)` while the app is on screen (Android
  12+ only lets an app start a foreground service from the foreground).
* The service speaks piece *i* and queues piece *i+1* behind it (no gap). It reports every change as a JSON event; the page
  mirrors it into the "Reading aloud" bar. After the page was paused or reloaded it asks `MidNoteReader.state()` and catches up.
* Android's speech engine cannot pause in the middle of a sentence: **Pause** stops, **Resume** starts the sentence again.
* Pause also happens by itself on a phone call or another app taking the audio, and when headphones are unplugged.
* The progress bar in the shade shows sentence *n* of *N* (one sentence = one second of "position").
* Android 13+ does not need the notification permission for media notifications.

## What was and was not checked

Checked off the phone: the Kotlin compiles against the real Android 35 classes; `ReaderCore` and `ReaderWire` have JVM tests
and every deliberate breakage of them is caught; the installer has tests (including putting files back on failure); the page
side has logic tests and app scenarios against a fake service. **NOT checked** (needs the phone): whether the notification
looks and behaves right on One UI, that reading continues with the screen off, audio focus with a real speech engine, and
that the CI build accepts it.
