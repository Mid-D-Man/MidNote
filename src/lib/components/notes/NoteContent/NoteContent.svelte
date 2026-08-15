<script lang="ts">
  // Deliberately NOT auto-growing to fit content anymore — see the
  // reasoning below and the note in +page.svelte's editor layout. A
  // large paste taking minutes to land was almost certainly this
  // element's height ballooning to match huge content (thousands of
  // lines = tens of thousands of px tall), forcing an expensive
  // synchronous reflow via scrollHeight on every change, on top of a
  // repeating-gradient background that then had to paint across that
  // entire height. Fixed height + internal scroll avoids both: the
  // element's size no longer depends on content length at all.
  import { tick } from "svelte";
  import { handleEnter } from "$lib/utils/textEditing";

  let {
    value = $bindable(""),
    textareaEl = $bindable(null),
    fontSize = 15,
  }: {
    value?: string;
    textareaEl?: HTMLTextAreaElement | null;
    fontSize?: number;
  } = $props();
  let el: HTMLTextAreaElement;

  $effect(() => {
    textareaEl = el;
  });

  async function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    const result = handleEnter(value, el.selectionStart);
    if (!result) return; // not a list line — let Enter behave normally
    e.preventDefault();
    value = result.newText;
    await tick();
    el.setSelectionRange(result.newCursorPos, result.newCursorPos);
  }
</script>

<textarea
  bind:this={el}
  bind:value
  {onkeydown}
  placeholder="Start typing..."
  class="note-content"
  style="font-size: {fontSize}px; line-height: {Math.round(fontSize * 1.7)}px"
></textarea>

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
    resize: none;
    overflow-y: auto;
    overflow-wrap: break-word;
    word-break: break-word;
    color: var(--text-hi);
    font-family: var(--font-sans);
    padding: var(--space-2) 0 var(--space-6);
  }
  .note-content::placeholder {
    color: var(--text-faint);
  }
</style>
