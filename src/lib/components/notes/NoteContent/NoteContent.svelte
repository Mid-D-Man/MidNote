<script lang="ts">
  // Real contenteditable now, not a <textarea> — a textarea has exactly
  // one font/weight/style for its entire content, so "make bold/italic/
  // underline actually render, and make font size apply only to a
  // selection or from the cursor forward" was never achievable with one.
  // note.content is now an HTML string instead of plain text (still just
  // a `string` field — no schema change needed, see mdix_files/schema).
  //
  // Deliberately NOT auto-growing to fit content, same reasoning as
  // before this rewrite: a large paste taking minutes to land was almost
  // certainly this element's height ballooning to match huge content,
  // forcing an expensive synchronous reflow on every change. Fixed
  // height + internal scroll avoids that regardless of what's inside.
  import { insertPlainText } from "$lib/utils/richText";

  let {
    value = $bindable(""),
    contentEl = $bindable(null),
    baseFontSize = 15,
  }: {
    value?: string;
    contentEl?: HTMLDivElement | null;
    baseFontSize?: number;
  } = $props();

  // Pasting from another app (Chrome, WhatsApp, Google Keep, ...) would
  // otherwise drag in arbitrary nested spans/colors/fonts that live in
  // note.content forever. Force plain text only, formatted fresh with
  // this editor's own toolbar if wanted.
  function onpaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    insertPlainText(text);
  }
</script>

<div
  bind:this={contentEl}
  bind:innerHTML={value}
  contenteditable="true"
  {onpaste}
  role="textbox"
  aria-multiline="true"
  aria-label="Note content"
  data-placeholder="Start typing..."
  class="note-content"
  class:empty={value.length === 0}
  style="font-size: {baseFontSize}px; line-height: {Math.round(baseFontSize * 1.7)}px"
></div>

<style>
  .note-content {
    display: block;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    /* Sized by the parent flex layout (see the editor page), not by its
       own content — see the script comment above for why. */
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
  /* Native list rendering for the bullet/numbered/roman toolbar buttons
     — roman gets its list-style-type set inline by richText.ts's
     applyListFormat, this just gives all three sane spacing/indent. */
  .note-content :global(ul),
  .note-content :global(ol) {
    margin: 0 0 var(--space-2);
    padding-left: 1.4em;
  }
  .note-content :global(li) {
    margin: 2px 0;
  }
</style>
