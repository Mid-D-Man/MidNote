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
  let { value = $bindable(""), textareaEl = $bindable(null) }: {
    value?: string;
    textareaEl?: HTMLTextAreaElement | null;
  } = $props();
  let el: HTMLTextAreaElement;

  $effect(() => {
    textareaEl = el;
  });
</script>

<textarea bind:this={el} bind:value placeholder="Start typing..." class="note-content"></textarea>

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
    font-size: 15px;
    line-height: 32px;
    padding: var(--space-2) 0 var(--space-6);
  }
  .note-content::placeholder {
    color: var(--text-faint);
  }
</style>
