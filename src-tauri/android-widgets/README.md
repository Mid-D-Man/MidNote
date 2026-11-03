<!-- Brought to u by MidManStudio -->
# MidNote home-screen widget

ONE widget with three buttons: **Note**, **Todo**, **Board**. Each opens MidNote on a blank editor of that kind. Nothing is
saved until you type something. The widget shows no data, so it never needs refreshing.

## Files

| File | What it is |
| --- | --- |
| `kotlin/MidNoteWidget.kt` | The widget's code: draws the three buttons and gives each a tap action (`midnote://new/note`, `/todo`, `/board`). |
| `res/layout/midnote_widget.xml` | The look: three equal buttons, icon over a word. Only views widgets allow (LinearLayout, ImageView, TextView). |
| `res/xml/midnote_widget_info.xml` | Size and picker entry: 4 x 1 cells by default, resizable. |
| `res/drawable/…` | Background, button background (with press ripple) and the three icons (vector). |
| `res/values/midnote_widget_strings.xml` | The words (widget name, description, labels, screen-reader text). |
| `install.py` | Puts all of the above into the generated Android project and adds the `<receiver>` to its manifest. |
| `test_install.py` | Tests for `install.py` (`python3 src-tauri/android-widgets/test_install.py`). |

Every resource name starts with `midnote_widget`, so none can clash with the app's own.

## How it gets into the app

`src-tauri/gen/android` is NOT committed: the workflow writes it fresh (`tauri android init`). The step **Add the
home-screen widget** in `.github/workflows/build-andriod.yml` then runs `install.py`, which

1. finds `MainActivity.kt` and copies `MidNoteWidget.kt` next to it (same package),
2. copies `res/` into the project,
3. checks that every resource and `R.id` used exists, and that MainActivity is still `singleTask`,
4. only then adds the `<receiver>` to `AndroidManifest.xml` (once; running it again changes nothing).

If any check fails it removes what it copied and stops with a message; the step is `continue-on-error`, so the app is still
built, without the widget, and **Check widget in the build** shows a warning.

## How a tap reaches the app

The button fires an explicit intent to `MainActivity` with the link `midnote://new/note|todo|board`.
`tauri-plugin-deep-link` passes it to the running app (`onNewIntent`) or to a cold start (`get_current`), but ONLY for hosts
listed in `tauri.conf.json` → `plugins.deep-link.mobile` (that is why `new` is listed next to `auth`).
`stores/openWith.svelte.ts` hands the link to `utils/widgetLinks.ts`, which accepts exactly those three links and maps
them to `/note/new`, `/todo/new`, `/board/new`; `routes/+layout.svelte` navigates there.

## Changing it

* Look: edit the files in `res/`. The widget cannot read the app's theme, so the colours are fixed (MidNote's dark theme).
* A fourth button: add a `LinearLayout` with a new `midnote_widget_<name>` id, its icon and strings, a line in
  `MidNoteWidget.kt`, a link in `utils/widgetLinks.ts` (and its route), and keep `tauri.conf.json` as it is (host `new`).
* Remove the widget: delete this folder and the two workflow steps, and the `new` entry in `tauri.conf.json`.

## What was and was not checked

Checked off the phone: the Kotlin compiles against the real Android API classes; the resources link (aapt); the installer
has tests for every check above; the app side (link parsing, opening the blank editors, cold and warm taps) has logic tests
and app scenarios. NOT checked: how the widget looks and behaves on a real launcher, and whether Android accepts
`android:exported="false"` on the receiver (if the widget is missing from the widget picker, set it to `true` in
`install.py`).
