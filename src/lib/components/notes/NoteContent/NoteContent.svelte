<script lang="ts">
  // Real contenteditable, not a <textarea> — a textarea has exactly one
  // font/weight/style for its entire content, so mixed formatting was
  // never achievable with one. note.content is an HTML string (still
  // just a `string` field — no schema change, see mdix_files/schema).
  //
  // Deliberately NOT auto-growing to fit content: fixed height + internal
  // scroll avoids a large paste forcing an expensive synchronous reflow.
  import { insertPlainText, wrapLastInsertedText, emptyPendingFormats, stripHtml, type PendingFormats } from "$lib/utils/richText";
  import { noteLinesEnabled } from "$lib/stores/settings.svelte";

  let {
    value = $bindable(""),
    contentEl = $bindable(null),
    baseFontSize = 15,
    pendingFormats = emptyPendingFormats(),
    onAutoFormatApplied,
  }: {
    value?: string;
    contentEl?: HTMLDivElement | null;
    baseFontSize?: number;
    // Bold/italic/underline/strikethrough/fontSize/color/backgroundColor
    // currently toggled on with no selection — see richText.ts's header
    // comment for why this is explicit page-owned state rather than
    // left to the browser's own (on real-device testing, unreliable)
    // sticky-typing tracking.
    pendingFormats?: PendingFormats;
    // Reports where the caret ended up right after an auto-format wrap,
    // so the page can tell "selection changed because of my own wrap"
    // apart from "selection changed because the user tapped/arrowed
    // somewhere else" and only reset pending formats for the latter.
    onAutoFormatApplied?: (node: Node, offset: number) => void;
  } = $props();

  // note.content's default is now "<div><br></div>" (see storage.ts's
  // createNote), not "" — a raw length check would think that's not
  // empty and hide the placeholder on every new note. stripHtml()
  // correctly reads it as empty since <br> and an empty <div> both
  // contribute no text.
  const isEmpty = $derived(stripHtml(value).length === 0);

  // Runs after the browser has already inserted typed/pasted text.
  // Nothing to do when no format is pending — this is the overwhelmingly
  // common case (most typing isn't happening right after a toolbar tap),
  // so it stays a cheap no-op then.
  //
  // Typed as plain Event, not InputEvent: TypeScript's DOM lib only
  // types oninput as InputEvent for <input>/<textarea>, not a generic
  // contenteditable <div> — even though the browser does fire a real
  // InputEvent here. Cast at the point of use instead of fighting that.
  function oninput(e: Event) {
    if (!contentEl) return;
    const ie = e as InputEvent;
    const hasPending =
      pendingFormats.bold ||
      pendingFormats.italic ||
      pendingFormats.underline ||
      pendingFormats.strikethrough ||
      pendingFormats.fontSize !== null ||
      pendingFormats.color !== null ||
      pendingFormats.backgroundColor !== null;

    if (hasPending && !ie.isComposing && ie.data && ie.inputType?.startsWith("insert")) {
      const pos = wrapLastInsertedText(contentEl, ie.data.length, pendingFormats);
      if (pos) onAutoFormatApplied?.(pos.node, pos.offset);
      // Explicit backstop, not a guess: don't assume Svelte's own
      // bind:innerHTML input listener necessarily runs before or after
      // this handler on every WebView — read the DOM back directly so
      // note.content is never a beat behind what's actually on screen.
      value = contentEl.innerHTML;
    }
  }

  // Pasting from another app would otherwise drag in arbitrary nested
  // spans/colors/fonts that live in note.content forever. Force plain
  // text only, applying whatever's currently pending to it.
  function onpaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    insertPlainText(text, pendingFormats);
    if (contentEl) value = contentEl.innerHTML;
  }
</script>

<div
  bind:this={contentEl}
  bind:innerHTML={value}
  contenteditable="true"
  {oninput}
  {onpaste}
  role="textbox"
  aria-multiline="true"
  aria-label="Note content"
  data-placeholder="Start typing..."
  class="note-content"
  class:empty={isEmpty}
  class:lined={noteLinesEnabled.value}
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
    outline: none;
    border: none;
    background: transparent;
    overflow-y: auto;
    overflow-wrap: break-word;
    word-break: break-word;
    color: var(--text-hi);
    font-family: var(--font-sans);
    padding: var(--space-2) 0 var(--space-6);
  }
  .note-content.empty::before {
    content: attr(data-placeholder);
    color: var(--text-faint);
    pointer-events: none;
  }
  .note-content :global(ul),
  .note-content :global(ol) {
    margin: 0 0 var(--space-2);
    padding-left: 1.4em;
  }
  .note-content :global(li) {
    margin: 2px 0;
  }

  /* Ruled-paper lines, toggled from Settings. Each paragraph the user
     creates by pressing Enter becomes its own <div> — this is Chromium's
     long-standing default contenteditable behavior, not something forced
     here via execCommand. Giving each of those its own border-bottom is
     what makes the rule line "reactive": a block's border sits at the
     bottom of its own box, which naturally already accounts for the
     tallest inline content inside it (a bigger font on part of that
     line makes the div taller, so the line the border draws moves down
     to match, with no measurement code needed at all — ordinary CSS box
     layout does this for free). This is only tested to the extent CSS
     box-model behavior is well-established platform knowledge; the
     interaction with contenteditable's line-wrapping on this specific
     WebView is still worth an on-device look.
     Known simplification, not a silent gap: this only covers actual
     typed paragraphs — it does not extend ruled lines into the blank
     space below the last paragraph, since that space has no element to
     attach a border to without either faking empty trailing divs or a
     separate fixed-grid background that can't perfectly line-align with
     variable-height real content above it. Left out rather than shipped
     half-aligned. */
  .note-content.lined :global(> div) {
    border-bottom: 1px solid var(--rule-color, rgba(150, 120, 60, 0.35));
  }
</style>
