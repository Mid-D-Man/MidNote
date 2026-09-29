<script lang="ts">
  // FOURTH REVISION — the big one. Everything before this comment in
  // this file's history (bind:innerHTML, then a hand-written one-
  // directional DOM->value sync, then three rounds of patches to
  // execCommand-driven formatting in richText.ts) was working around
  // the same underlying fact: document.execCommand plus manual
  // Range/Selection surgery on a raw contenteditable has no single
  // source of truth for "what's formatted right now" other than the
  // live DOM itself, and browsers — Android WebView specifically, but
  // this was never actually Android-only — don't manipulate that DOM in
  // fully predictable ways. Three rounds of fixes for the same leak/
  // revert/doesn't-apply class of bug, one of which made things worse
  // on re-test, is the actual evidence that patching that layer further
  // wasn't going to convincingly finish.
  //
  // This file now wraps Tiptap (a thin, Svelte-agnostic layer over
  // ProseMirror) instead. The difference that actually matters here
  // isn't the library name, it's the architecture: ProseMirror keeps
  // its own document model — nodes and marks in a tree, not "whatever
  // the DOM happens to contain" — and every edit goes through a
  // transaction that's applied to that model first, with the DOM
  // reconciled to match afterward, in ProseMirror's own well-tested
  // reconciliation code rather than this app's. "Bold with the cursor
  // collapsed, no selection, so the next characters typed come out
  // bold" — the entire PendingFormats/wrapLastInsertedText machinery
  // this file used to contain — is a native, built-in feature of that
  // model called "stored marks," not something to hand-roll. No
  // execCommand anywhere in this file or its extensions.
  //
  // Honest limits, not oversold: this does NOT make every Android
  // WebView input quirk disappear. ProseMirror still renders into a
  // real contenteditable element and still depends on the browser
  // delivering sane input/composition events — confirmed independently
  // (not just theorized) that the specific "Samsung Keyboard spam of
  // newlines" bug reproduces in a plain ProseMirror editor exactly like
  // it does in raw contenteditable, because the bug is in the WebView/
  // keyboard layer, below either. Worth watching for on-device — if it
  // shows up, there's a small, specifically-scoped, community-tested
  // guard for that exact signature (not applied here yet, since it's
  // not been observed in this app and a defensive patch for a bug that
  // may not occur here is its own source of false positives).
  import { onDestroy, untrack } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  // Round 29: checklist blocks. TaskList/TaskItem ship in the same
  // @tiptap/extension-list package StarterKit already depends on (that's
  // where its bullet/ordered lists come from), so this adds no new
  // package to the install — it's resolved as StarterKit's own sibling.
  import { TaskList, TaskItem } from "@tiptap/extension-list";
  import Paragraph from "@tiptap/extension-paragraph";
  import { Bold } from "@tiptap/extension-bold";
  import { Italic } from "@tiptap/extension-italic";
  import { Strike } from "@tiptap/extension-strike";
  import { Underline } from "@tiptap/extension-underline";
  import { TextStyle, Color, BackgroundColor, FontSize } from "@tiptap/extension-text-style";
  import { Placeholder } from "@tiptap/extensions";
  import { PersistentMarks } from "$lib/utils/persistentMarksExtension";
  import { FindReplace } from "$lib/utils/findReplaceExtension";
  import { PlainTextPaste } from "$lib/utils/plainTextPasteExtension";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { stripHtml } from "$lib/utils/richText";
  import { noteLinesEnabled } from "$lib/stores/settings.svelte";

  // Paragraphs render/parse as <div>, matching every note already saved
  // by the previous contenteditable-based editor (note.content is still
  // just an HTML string in storage — no schema change). Tiptap's own
  // default is <p>; overriding both parseHTML and renderHTML keeps
  // existing notes loading exactly as before and keeps the ruled-lines
  // CSS below (which targets child <div> elements specifically) working
  // unchanged.
  const DivParagraph = Paragraph.extend({
    parseHTML() {
      return [{ tag: "div" }, { tag: "p" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", HTMLAttributes, 0];
    },
  });

  // inclusive: false on every mark that can be applied to a selection —
  // see persistentMarksExtension.ts's header comment for the full
  // mechanism this closes (the reported "selected text, formatted it,
  // and it kept leaking into whatever I typed next" bug) and why
  // PersistentMarks (added to the extension list below) is what keeps
  // this from breaking ordinary multi-character cursor-mode typing at
  // the same time. Bundled here as one small set of overrides rather
  // than spread across separate files, since they only make sense read
  // together with that extension.
  const NonLeakingBold = Bold.extend({ inclusive: false });
  const NonLeakingItalic = Italic.extend({ inclusive: false });
  const NonLeakingStrike = Strike.extend({ inclusive: false });
  const NonLeakingUnderline = Underline.extend({ inclusive: false });
  const NonLeakingTextStyle = TextStyle.extend({ inclusive: false });

  let {
    value = $bindable(""),
    editor = $bindable(null),
    tick = $bindable(0),
    baseFontSize = 15,
    syncToken = 0,
    hasSelection = $bindable(false),
  }: {
    value?: string;
    // The live Tiptap Editor instance, handed up so the toolbar and the
    // page can call editor.chain()... commands and read
    // editor.isActive(...)/editor.state directly, instead of this
    // component owning a bespoke formatting API those callers would
    // otherwise have to go through. Not reactive by itself (it's a
    // plain class instance) — see `tick` below.
    editor?: Editor | null;
    // Bumped on every Tiptap transaction (content OR selection change).
    // `editor` doesn't change identity when its internal state changes,
    // so anything outside this component that reads editor.isActive(...)
    // or editor.state.selection needs its own reactive signal to know
    // when to re-read — this is that signal. `value` alone doesn't
    // cover it: moving the cursor or changing the selection updates
    // active-mark state without changing the document, so it wouldn't
    // bump `value`.
    tick?: number;
    baseFontSize?: number;
    // Bumped by the page exactly when `value` should be pushed INTO the
    // editor from outside: note load (id change) only now — undo/redo
    // is Tiptap's own History extension internally, not a page-level
    // stack pushed back in through this prop any more.
    syncToken?: number;
    hasSelection?: boolean;
  } = $props();

  const isEmpty = $derived(stripHtml(value).length === 0);

  let element: HTMLDivElement | undefined = $state();

  function createEditor(initialContent: string): Editor {
    return new Editor({
      element,
      extensions: [
        StarterKit.configure({
          paragraph: false,
          bold: false,
          italic: false,
          strike: false,
          underline: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          link: false,
          gapcursor: false,
        }),
        DivParagraph,
        // Round 29: "- [ ]" style checklist inside a note. Non-nested (a
        // task item holds paragraphs only) — nesting is a Tab-key
        // affordance and there is no Tab key on the phone this targets.
        // Saved HTML is <li data-type="taskItem" data-checked="...">, which
        // TaskItem parses straight back, so notes round-trip unchanged.
        TaskList,
        TaskItem,
        NonLeakingBold,
        NonLeakingItalic,
        NonLeakingStrike,
        NonLeakingUnderline,
        NonLeakingTextStyle,
        Color,
        BackgroundColor,
        FontSize,
        PersistentMarks,
        // Round 26: regex find & replace. Registers only the plugin
        // (state + highlight decorations) — it is inert until the find
        // bar sets a query, and the bar drives it through
        // findReplaceExtension.ts's exported functions, never through
        // editor commands. See that file's header comment.
        FindReplace,
        // Round 27: plain-text paste, replacing round 25's inline
        // handlePaste. See plainTextPasteExtension.ts's header for why
        // (handlePaste runs AFTER ProseMirror's own clipboard pre-parse,
        // and never sees text an Android keyboard commits as an input
        // event instead of a paste). `log` feeds the on-device debug
        // panel so the path a big paste actually takes is visible.
        PlainTextPaste.configure({ log: breadcrumb }),
        Placeholder.configure({
          placeholder: "Start typing...",
          // REVISION: default showOnlyCurrent means "only the node the
          // cursor is in" — so pressing Enter to start a new paragraph
          // made THAT (now-current, empty) paragraph show the
          // placeholder too, regardless of how much text already exists
          // earlier in the note. Reported directly: "start typing...
          // shows up no matter how much I've actually written." Wanted
          // (and what the old CSS-only placeholder actually did):
          // show only when the WHOLE note is empty. emptyNodeClass as a
          // function, gated on editor.isEmpty (whole-document, not
          // per-node) rather than the plugin's own per-node default —
          // when it returns "", the class this file's CSS keys off of
          // never gets applied, so the ::before rule simply doesn't
          // match, regardless of data-placeholder being present.
          emptyNodeClass: ({ editor: e }) => (e.isEmpty ? "is-empty" : ""),
        }),
      ],
      content: initialContent,
      // (Round 25's editorProps.handlePaste lived here. Removed in round
      // 27 — its "skips the HTML-parsing pipeline" claim was wrong, it
      // split the current line on a mid-line paste, and it left a stray
      // empty paragraph at each end when pasting into an empty note.
      // Paste + IME multi-line input are handled by PlainTextPaste above.)
      onTransaction: ({ editor: e }) => {
        tick++;
        hasSelection = !e.state.selection.empty;
      },
      onUpdate: ({ editor: e }) => {
        // Timed (round 27 diagnostics): getHTML() is O(document) and runs
        // on every content change, so a very large note makes each
        // keystroke pay for the whole document. Logged only when it's
        // slow enough to matter.
        const t0 = performance.now();
        value = e.getHTML();
        const ms = performance.now() - t0;
        if (ms >= 100) breadcrumb(`note editor: getHTML() took ${Math.round(ms)}ms (${value.length} chars)`);
      },
    });
  }

  onDestroy(() => {
    editor?.destroy();
  });

  // Round 27 diagnostics: report main-thread stalls into the on-device
  // debug log. A "long task" is any single block of work over 50ms; only
  // the big ones (300ms+) are logged. Shows how long the UI was actually
  // frozen after a large paste regardless of WHICH code path caused it —
  // the one number the paste investigation couldn't get from off-device.
  // Reads no reactive state (nothing here can re-trigger itself).
  $effect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let po: PerformanceObserver | null = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 300) breadcrumb(`long task: main thread blocked ${Math.round(entry.duration)}ms`);
        }
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch {
      po = null; // longtask entries unsupported on this WebView — diagnostics only, safe to skip
    }
    return () => po?.disconnect();
  });

  // The only place a note-load should reinitialize the editor from
  // outside. Destroys and recreates rather than calling
  // editor.commands.setContent() on the existing instance: Tiptap's
  // History extension tracks undo/redo against the live document model,
  // and there's no confirmed-safe way from this sandbox to verify that
  // replacing content on a live instance resets that history rather
  // than leaving a step behind that could undo back into a DIFFERENT
  // note's content after switching. A fresh instance has fresh,
  // guaranteed-empty history — no ambiguity to resolve.
  //
  // Gated on syncToken specifically (bumped by the page on note load
  // only, not on undo/redo any more — Tiptap owns its own undo/redo
  // internally now), read via untrack() so this effect reacts ONLY to
  // syncToken changing, never to `value` changing on its own — same
  // discipline docs/svelte5-effect-safety.md already established, same
  // reason: if this also depended on `value`, every keystroke would
  // trigger a full editor teardown/rebuild.
  $effect(() => {
    syncToken;
    if (!element) return;
    const html = untrack(() => value);
    untrack(() => editor)?.destroy();
    editor = createEditor(html);
  });
</script>

<div
  bind:this={element}
  class="note-content"
  class:empty={isEmpty}
  class:lined={noteLinesEnabled.value && !hasSelection}
  style="font-size: {baseFontSize}px; line-height: {Math.round(baseFontSize * 1.7)}px"
></div>

<style>
  .note-content {
    display: block;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* Theme-aware, with the plain token as fallback. Load-bearing since
       the body image wash dropped to ~0.18 (see note/[id]/+page.svelte's
       BODY_IMAGE_WASH): before that the text sat on a near-opaque
       --surface and the fixed token was always safe, but now it sits on
       the photo itself. --theme-text-hi is set inline by that route for
       the image case only, from colorthief's real per-image light/dark
       sample — so this picks up dark text over a light photo and light
       text over a dark one, instead of staying one fixed colour and
       becoming unreadable over half of them. */
    color: var(--theme-text-hi, var(--text-hi));
    font-family: var(--font-sans);
    padding: var(--space-2) 0 var(--space-6);
  }
  /* Tiptap mounts its own contenteditable (class ProseMirror) as a
     child of the element it's given, rather than making that element
     itself editable — every selector below that used to target this
     wrapper directly now targets .note-content :global(.ProseMirror)
     instead. */
  .note-content :global(.ProseMirror) {
    outline: none;
    border: none;
    background: transparent;
    overflow-wrap: break-word;
    word-break: break-word;
    min-height: 100%;
  }
  .note-content :global(.ProseMirror ul),
  .note-content :global(.ProseMirror ol) {
    margin: 0 0 var(--space-2);
    padding-left: 1.4em;
  }
  .note-content :global(.ProseMirror li) {
    margin: 2px 0;
  }
  /* Round 29: checklist. The checkbox is Tiptap's own <label><input
     type=checkbox></label> node view; the item text sits in the sibling
     <div>. Checked items are struck through and dimmed (the Notion
     reference), never hidden — the text stays editable.
     Selectors go through ul[data-type="taskList"] > li on purpose: the
     LIVE node-view <li> carries only data-checked, NOT data-type (that
     attribute exists in the saved HTML, not in the editing DOM) — found by
     the round 29 tests; a li[data-type="taskItem"] selector matches
     nothing on screen. */
  .note-content :global(.ProseMirror ul[data-type="taskList"]) {
    list-style: none;
    padding-left: 0;
  }
  .note-content :global(.ProseMirror ul[data-type="taskList"] > li) {
    display: flex;
    align-items: flex-start;
    gap: 0.55em;
    margin: 4px 0;
  }
  .note-content :global(.ProseMirror ul[data-type="taskList"] > li > label) {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    /* Padding grows the tap target well past the 1.2em box itself. */
    padding: 0.2em 0.15em;
    user-select: none;
  }
  .note-content :global(.ProseMirror ul[data-type="taskList"] > li > label input[type="checkbox"]) {
    width: 1.2em;
    height: 1.2em;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }
  .note-content :global(.ProseMirror ul[data-type="taskList"] > li > div) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .note-content :global(.ProseMirror ul[data-type="taskList"] > li[data-checked="true"] > div) {
    text-decoration: line-through;
    opacity: 0.55;
  }
  /* Placeholder extension marks the empty paragraph with is-empty and
     sets data-placeholder on it — same attr(data-placeholder) pattern
     the old CSS-only placeholder used, just driven by Tiptap now. */
  .note-content :global(.ProseMirror .is-empty::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    /* Same reasoning as the main text colour above — the placeholder
       sits on the photo too once a body image theme is active. */
    color: var(--theme-text-lo, var(--text-faint));
    pointer-events: none;
  }

  /* Ruled-paper lines, toggled from Settings. Unchanged reasoning from
     the previous version of this file: each paragraph is its own <div>
     (DivParagraph above), giving each one its own border-bottom makes
     the rule line sit under whatever that paragraph's own tallest
     inline content is, with no measurement code — ordinary CSS box
     layout. Known simplification, not a silent gap: only covers actual
     typed paragraphs, not the blank space below the last one. */
  .note-content.lined :global(.ProseMirror > div) {
    border-bottom: 1px solid var(--rule-color, rgba(150, 120, 60, 0.35));
  }

  /* Find & replace highlights (round 26) — inline decorations added by
     findReplaceExtension.ts while the find bar has a query. Background
     only, so the note's own text/mark colours stay readable. The
     zero-length "caret" is the marker for anchor matches like ^ and $,
     which have no width to paint. */
  .note-content :global(.ProseMirror .find-match) {
    background: rgba(234, 179, 8, 0.38);
    border-radius: 2px;
  }
  .note-content :global(.ProseMirror .find-match-current) {
    background: rgba(249, 115, 22, 0.66);
    outline: 1px solid rgba(249, 115, 22, 0.95);
  }
  .note-content :global(.ProseMirror .find-caret) {
    display: inline-block;
    width: 0;
    height: 1.1em;
    margin-left: -1px;
    border-left: 2px solid rgba(234, 179, 8, 0.95);
    vertical-align: text-bottom;
  }
  .note-content :global(.ProseMirror .find-caret-current) {
    border-left: 3px solid rgba(249, 115, 22, 1);
  }
</style>
