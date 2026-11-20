# MidNote in Android's text-selection menu

Select text in any app, open its "..." menu: **MidNote: Read aloud** and **MidNote: Make a note**.

How it works (and why it is built this way):

- Android lists every activity with an intent-filter for `android.intent.action.PROCESS_TEXT` in that menu, one entry per
  activity. `kotlin/ProcessTextActivities.kt` has two (`ProcessTextReadActivity`, `ProcessTextNoteActivity`). They draw
  nothing: they take `EXTRA_PROCESS_TEXT`, build a link and finish at once. They return no result, so the app the text was
  selected in leaves it unchanged.
- The link is `midnote://text/read|note?id=<fresh id>&t=<text, percent-encoded>[&cut=1]`, sent to MainActivity. The deep-link
  plugin already reports every `midnote://` link to the page (the home-screen widget uses the same door), so **MainActivity.kt
  is not changed**.
- The page side is `src/lib/utils/textLinks.ts` (parsing, limits, replay guard) and `handleTextLink` in
  `src/lib/stores/openWith.svelte.ts`. As with the widget's links, **a link never creates anything by itself**: "Make a note"
  shows the text in the same sheet a file opened with MidNote uses, and a note exists only after **Create note**. "Read aloud"
  starts reading and the app steps back (`window.MidNoteReader.sendToBack()`, see `android-reader/kotlin/ReaderBridge.kt`), so
  the person is back in the app they selected the text in while the background reader carries on.
- Android can hand the same link over again (the app coming back from recents, a page reload), so every selection gets a
  fresh id and the page ignores an id it has already acted on.
- At most 30,000 characters are taken. The link travels in an Intent (about 1 MB per transaction, text held as UTF-16), and
  30,000 characters of Chinese or Japanese already become about 540 KB of it.

`install.py` is run by the Android workflow after `tauri android init` (see "Add the text-selection actions" in
`.github/workflows/build-andriod.yml`): it copies the Kotlin next to MainActivity.kt (rewriting the package line), adds the two
`<activity>` entries to the manifest, checks its own work and puts everything back if anything is off, so the app still builds,
just without the menu entries. `test_install.py` runs it against a stand-in project: `python3 test_install.py`.

Not covered by any test here: the Kotlin itself compiling, and the real selection menu (only a phone can show those). The
workflow's "Check text actions in the build" step says whether the manifest entries and the compiled classes are in the APK.
