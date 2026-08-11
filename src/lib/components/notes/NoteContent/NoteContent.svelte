<script lang="ts">
  let {
    value = $bindable(""),
    textareaEl = $bindable(null),
  }: { value?: string; textareaEl?: HTMLTextAreaElement | null } = $props();
  let el: HTMLTextAreaElement;

  function autoResize() {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  $effect(() => {
    textareaEl = el;
  });

  $effect(() => {
    value; // re-run on change
    autoResize();
  });
</script>

<textarea
  bind:this={el}
  bind:value
  oninput={autoResize}
  placeholder="Start typing..."
  class="note-content"
></textarea>

<style>
  .note-content {
    width: 100%;
    min-height: 400px;
    outline: none;
    border: none;
    background: transparent;
    resize: none;
    color: var(--text-hi);
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 32px;
    padding: var(--space-2) 0 var(--space-6);
    /* Faint ruled-paper lines, tying into the vellum motif — one hairline
       every 32px, matching line-height so text sits right on each rule. */
    background-image: repeating-linear-gradient(
      to bottom,
      transparent,
      transparent 31px,
      var(--hairline) 31px,
      var(--hairline) 32px
    );
  }
  .note-content::placeholder {
    color: var(--text-faint);
  }
</style>
