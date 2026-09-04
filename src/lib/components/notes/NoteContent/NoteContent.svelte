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
  import Paragraph from "@tiptap/extension-paragraph";
  import { TextStyle, Color, BackgroundColor, FontSize } from "@tiptap/extension-text-style";
  import { Placeholder } from "@tiptap/extensions";
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
          blockquote: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          link: false,
          gapcursor: false,
        }),
        DivParagraph,
        TextStyle,
        Color,
        BackgroundColor,
        FontSize,
        Placeholder.configure({ placeholder: "Start typing..." }),
      ],
      content: initialContent,
      onTransaction: ({ editor: e }) => {
        tick++;
        hasSelection = !e.state.selection.empty;
      },
      onUpdate: ({ editor: e }) => {
        value = e.getHTML();
      },
    });
  }

  onDestroy(() => {
    editor?.destroy();
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
    color: var(--text-hi);
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
  /* Placeholder extension marks the empty paragraph with is-empty and
     sets data-placeholder on it — same attr(data-placeholder) pattern
     the old CSS-only placeholder used, just driven by Tiptap now. */
  .note-content :global(.ProseMirror .is-empty::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-faint);
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
</style>
