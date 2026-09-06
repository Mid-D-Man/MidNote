# Migration: raw contenteditable + execCommand → Tiptap/ProseMirror

**Date:** 2026-09-05
**Status:** Migrated, and the specific bugs found after migrating are fixed
and verified. Read this before touching `NoteContent.svelte`,
`FormattingToolbar.svelte`, `persistentMarksExtension.ts`, or anything else
under `src/lib/components/notes/`.

## Why this happened

Four rounds of fixes to the note editor's rich-text formatting all lived in
the same place: `document.execCommand` plus manual DOM/Range surgery on a
raw `contenteditable` div, in what used to be `src/lib/utils/richText.ts`.
Each round fixed something real and confirmed working, and each round
either left something else broken or (once) actively made a previously-fine
case worse on re-test. In order, roughly:

1. Bold/italic/underline/strikethrough not applying at all for plain
   typing (no selection) — root cause was `oninput`'s guard requiring a
   well-formed `InputEvent` (`data` non-empty, `inputType` starting with
   `"insert"`), which real Android keyboards don't reliably produce.
2. Selection formatting leaking into text typed afterward — root cause
   theorized as `execCommand`'s own "typing style" not clearing on a
   script-driven selection change, "fixed" by walking the caret out of the
   formatting element via `collapseOutsideFormatting`.
3. Background color specifically still leaking (text color didn't) —
   "fixed" by landing the caret in a synthetic empty text node instead of
   an Element+offset position. **This fix regressed text color, which had
   been fine.** Reverted.
4. A parallel round of UI bugs (native `<select>` elements silently not
   opening because an ancestor's `guardFocus` `preventDefault()` on
   `pointerdown` was bubbling up and suppressing them; font-size/color
   controls in a header sheet reverting immediately after being tapped,
   because the same kind of focus-steal was tripping `refreshFormatState`'s
   "the user left the editor" branch) — fixed, but each fix was another
   patch onto the same execCommand-adjacent state machine
   (`pendingFormats`, `capturedFormatRange`, `formatPickerOpen`,
   `lastAutoFormatPos`/`lastKnownCaretPos`).

None of these fixes were wrong reasoning applied to bad evidence — each was
confirmed as far as it's possible to confirm anything in a sandbox with no
real Android device and no `execCommand` support in jsdom. But three
rounds on the same *class* of bug (formatting state not tracking reality,
one of which actively regressed) is itself evidence: `execCommand` plus
hand-maintained DOM state genuinely doesn't have a reliable single source
of truth for "what's formatted right now," independent of how carefully
each individual patch is reasoned through.

## The migration

Replaced the entire `contenteditable` + `execCommand` + `richText.ts`
formatting layer with [Tiptap](https://tiptap.dev) (a thin wrapper over
[ProseMirror](https://prosemirror.net)). The difference that matters isn't
the library name, it's the architecture: ProseMirror keeps its own document
model (a tree of nodes and marks) and reconciles the actual DOM to match
that model after every transaction, in ProseMirror's own reconciliation
code — not this app's. "Bold with the cursor collapsed, so whatever gets
typed next comes out bold" (the entire `pendingFormats`/
`wrapLastInsertedText` system) is a *native* ProseMirror feature called
**stored marks**, not something to hand-roll.

`richText.ts` is now three pure HTML↔text functions (`stripHtml`,
`htmlToPlainText`, `plainTextToHtml`) that other files still use for
previews/export/paste — nothing DOM-manipulation- or
execCommand-adjacent survives.

Notes are still stored as plain HTML strings (`note.content`) — no storage
migration. Tiptap's `Paragraph` node is overridden (`DivParagraph` in
`NoteContent.svelte`) to parse/render as `<div>` instead of Tiptap's
default `<p>`, specifically so every note saved by the old editor loads
unchanged. **Confirmed directly, not assumed:** a script fed the real,
existing div-based HTML through the new editor and checked it round-trips
without throwing and without losing content.

### What this does *not* fix

Migrating does not make every Android WebView input quirk disappear.
Independently confirmed: the exact "Samsung Keyboard causes a spam of
newlines in an Android WebView" bug reproduces identically in a plain,
vanilla ProseMirror editor and in raw `contenteditable`
([discuss.prosemirror.net thread](https://discuss.prosemirror.net/t/samsung-keyboard-within-android-webview-causes-a-spam-of-new-lines/5246),
confirmed by someone who tested both) — because that bug lives in the
WebView/keyboard layer, below any editor framework, not in ProseMirror's
own code. If something in that shape shows up, it needs its own targeted
fix (that thread also documents one: Samsung Keyboard's "Suggest text
corrections," powered by Grammarly on One UI 5+, is often the actual
trigger, and updating to One UI 5.1+ has reportedly resolved it for some
users) — not another rewrite of the editor core.

## Bugs found *after* migrating, and their fixes

Moving to Tiptap did not mean zero new bugs — three showed up on the very
next round of on-device testing. All three are now fixed and verified;
documenting them here because they're the kind of thing that's easy to
reintroduce by "simplifying" this code later without knowing why it's
shaped the way it is.

### 1. Font size/color controls "not working at all" after the migration

**Symptom:** tapping color swatches or dragging the font-size slider in
the toolbar's popups sometimes did nothing, inconsistently.

**Root cause:** `FormatValuePicker` (now split into `FontSizePicker` +
`ColorSwatchPicker`) had a `guardFocus` (`preventDefault()` on
`pointerdown`) wrapping *all* of its controls, including the font-size
`<input type="range">`. `preventDefault()` on an ancestor's `pointerdown`
suppresses a descendant native form control's own default action even
though the handler isn't bound to that control directly — the same
mechanism as the round-1 `<select>` bug, just hitting a different control.
A `<select>` needs its `pointerdown`'s default action to open its native
picker; a range input needs it to start tracking a drag at all. Applying
one guard uniformly to a mix of buttons (fine with this pattern, confirmed
repeatedly) and a slider (broken by it) was the mistake.

**Fix:** removed the `preventDefault`-based guard from these popups
entirely. The thing it was protecting against — a tap stealing focus from
the note body, which used to trip a page-level `refreshFormatState`
"the user left" branch and wipe pending formatting state — doesn't exist
in the Tiptap version: `editor.chain().focus()....run()` is
selection-safe by Tiptap's own design, so there's no fragile state to
protect from focus loss in the first place.

**Lesson:** *never* wrap a native `<input type="range">` (or `<select>`,
or any native form control) in a blanket `preventDefault()`-on-pointerdown
guard meant for buttons. If a future control needs focus protection,
scope the guard to exactly the elements that need it, or better, find out
first whether the underlying reason for wanting focus protection still
applies at all (in Tiptap's case, it usually doesn't).

### 2. Selection formatting still leaking past the selection boundary

**Symptom:** select text, bold it (or apply a color), and text typed
*immediately adjacent to* the formatted selection afterward also came out
bold/colored — requiring manually toggling the format back off.

**Root cause, confirmed directly:** ProseMirror marks default to
`inclusive: true`. A cursor sitting exactly at the *end* of a marked
range is treated as still "inside" that mark for deciding what the next
typed character inherits. Reproduced precisely: select "hello" in "hello
world", bold it, move the cursor to sit right after "hello" (position 6,
the exact boundary), and `selection.$from.marks()` at that position
returns `['bold']` — confirmed via a script calling the real
`editor.chain()` API and inspecting `editor.state` directly, not
inferred.

**The complication:** the obvious fix (`inclusive: false` on every
formatting mark) closes this immediately, but breaks something else:
typing several characters in a row while a format is toggled on with *no*
selection (cursor-mode/stored-marks) relies on that same `inclusive: true`
boundary behavior — `storedMarks` gets cleared after being consumed by a
single transaction, and multi-keystroke typing was silently relying on
`$from.marks()`'s inclusive fallback to keep re-deriving the same answer
for every subsequent keystroke. Confirmed directly: with `inclusive:
false` and nothing else changed, typing "hello" one keystroke at a time
while bold was toggled on produced `<strong>h</strong>ello` — only the
first character landed inside the mark.

**Fix:** `src/lib/utils/persistentMarksExtension.ts` — a small ProseMirror
plugin using the library's own plugin-state mechanism. It remembers
whatever a cursor-mode toggle just set as `storedMarks` (detected via
`tr.storedMarksSet`, not inferred), and re-asserts that memory on every
following transaction that inserts text with the cursor still collapsed.
The memory is dropped the instant a transaction changes the selection
*without* also changing the document — a plain cursor move with nothing
typed, which is exactly "the user left" rather than "the user kept
typing," and is when non-inclusive marks are supposed to take back over.
Applied via `Bold.extend({ inclusive: false })` (and the same for Italic,
Strike, Underline, and the shared `TextStyle` mark that carries
color/background/font-size) in `NoteContent.svelte`, together with this
extension in the same file's extension list — the two only make sense
paired.

**Confirmed together, not separately** (a script exercises all of these
against the real extension configuration): selection-boundary leak
closed, for both an inline mark (bold) and an attribute-carrying mark
(color); per-character cursor-mode typing still lands in one run; toggling
off mid-stream doesn't re-leak; navigating away with no text typed drops
the memory so unrelated typing elsewhere afterward doesn't inherit
anything.

**Lesson:** if a future formatting bug looks like "a mark applies
correctly once, but the boundary behavior around it is wrong," check
`inclusive` and `storedMarks` before assuming it's an execCommand-style
bug (it isn't — there's no `execCommand` left in this app to blame) or
reaching for another `collapseOutsideFormatting`-style DOM hack (that
pattern belongs to the old system and doesn't apply to ProseMirror's
model at all).

### 3. Placeholder text showing on a note that already has content

**Symptom:** "Start typing..." appearing after pressing Enter, regardless
of how much text already existed earlier in the note.

**Root cause:** Tiptap's `Placeholder` extension defaults to
`showOnlyCurrent: true`, which means "only the node the cursor is
currently in" — not "only when the whole document is empty." Pressing
Enter creates a new, empty paragraph; that paragraph becomes "current";
the placeholder shows there regardless of sibling content.

**Fix:** `emptyNodeClass` configured as a function gated on
`editor.isEmpty` (a whole-document check) rather than the plugin's own
per-node default:
```ts
emptyNodeClass: ({ editor }) => (editor.isEmpty ? "is-empty" : "")
```
When it returns `""`, the CSS class this file's `::before` placeholder
styling keys off of never gets applied, regardless of `data-placeholder`
being present on that node.

## Files touched

- `src/lib/components/notes/NoteContent/NoteContent.svelte` — rebuilt on
  Tiptap's `Editor` class. Owns extension configuration, including the
  `inclusive: false` overrides and `PersistentMarks`.
- `src/lib/utils/persistentMarksExtension.ts` — new. The ProseMirror
  plugin described above.
- `src/lib/components/notes/FormattingToolbar/FormattingToolbar.svelte` —
  rebuilt around `editor.chain().focus()....run()` commands. No more
  `onCaptureRange`/`capturedFormatRange`/`pendingFormats`. Three separate
  popup triggers (format, size, color, background — direct request, not
  one combined popup), anchored above the toolbar rather than a
  full-screen sheet (FlyNote's editor was the reference point), and
  positioned above the on-screen keyboard via
  `src/lib/utils/keyboardInset.svelte.ts` (tracks
  `window.visualViewport`).
- `src/lib/components/notes/FontSizePicker/FontSizePicker.svelte` and
  `src/lib/components/notes/ColorSwatchPicker/ColorSwatchPicker.svelte` —
  new, split out of a single combined picker per direct request, each
  with its own close (X) button.
- `src/lib/components/notes/NoteEditorHeader/NoteEditorHeader.svelte` —
  reverted to just Share/Duplicate; formatting controls live in the
  toolbar again, not the header's Actions sheet.
- `src/routes/note/[id]/+page.svelte` — drastically simplified.
  `pendingFormats`, `capturedFormatRange`,
  `lastAutoFormatPos`/`lastKnownCaretPos`, `formatPickerOpen`,
  `refreshFormatState`, and the entire hand-rolled undo/redo stack are
  gone. The page just holds the live `editor` instance (handed up from
  `NoteContent` via `bind:editor`) and a `tick` counter (bumped on every
  Tiptap transaction, since `editor` doesn't change identity when its
  internal state does) for the toolbar to react to.
- `src/lib/utils/richText.ts` — gutted to the three pure conversion
  functions described above.
- `src/lib/utils/selectionActions.ts` — unrelated to this migration, but
  see its own header comment for the separate Android
  download/scoped-storage fix from the previous round.

## Verification

`svelte-check --fail-on-warnings`, `vite build`, and `npm run smoke` all
passing is necessary but nowhere near sufficient for this kind of change
— none of them exercise actual editing behavior. What actually mattered:

- **Direct mark-logic testing**, new for this codebase: because
  ProseMirror doesn't touch `execCommand` at all, its mark/selection
  logic runs in plain, testable JS. A script imported the real
  `@tiptap/core` + the app's actual extension configuration, called
  `editor.chain()....run()` the same way the toolbar does, and inspected
  `editor.getHTML()`/`editor.state` directly — no jsdom
  `execCommand`-shaped limitation applies here, unlike every previous
  round's verification of this same class of bug. This is what caught
  the `inclusive: false` cursor-mode regression *before* shipping it,
  where the old system's rounds 2 and 3 didn't have an equivalent way to
  catch their own regressions ahead of an on-device report.
- **Real-build UI testing**, same pattern as previous rounds: booted the
  actual production build headlessly, drove real clicks and a real
  `selectionchange`, confirmed popups open/close, list/undo controls
  hide during a selection, and (this round) that the three format popups
  are genuinely separate and each has a working close button.
- **jsdom's own gaps, worked around, not ignored:** jsdom has no real
  layout engine, so `Range.getClientRects()`/`getBoundingClientRect()`
  (which ProseMirror calls during ordinary transaction handling, for
  scroll-into-view) aren't implemented. Stubbed to zero-rects for test
  purposes only — a real browser has these; this is a test-environment
  gap, not something being tested.
- **Still not verifiable from this sandbox:** real Android WebView/
  Samsung Keyboard input event behavior feeding into ProseMirror (no real
  device, no way to drive a real on-screen keyboard). Flagged rather than
  asserted, same honesty bar as every round before this one.
