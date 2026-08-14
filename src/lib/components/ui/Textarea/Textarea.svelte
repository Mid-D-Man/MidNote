<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "",
    class: className = "",
    minHeight = "100px",
    oninput,
  }: {
    value?: string;
    placeholder?: string;
    class?: string;
    minHeight?: string;
    oninput?: (e: Event) => void;
  } = $props();
</script>

<textarea
  bind:value
  {placeholder}
  class="textarea {className}"
  style="min-height: {minHeight}"
  oninput={(e) => oninput?.(e)}
></textarea>

<style>
  .textarea {
    display: block;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    /* Fixed min-height + internal scroll, deliberately not auto-growing
       — same reasoning as NoteContent: content length shouldn't drive
       layout cost or push surrounding elements around. */
    resize: none;
    overflow-y: auto;
    overflow-wrap: break-word;
    word-break: break-word;
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .textarea::placeholder {
    color: var(--text-faint);
  }
  .textarea:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
</style>
