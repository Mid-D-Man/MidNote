<script lang="ts">
  // Ported from the original, with one deliberate change: the original
  // wired these buttons to document.execCommand against a plain
  // <textarea>, which execCommand can't actually format (it only affects
  // contenteditable regions). Since content really is a plain string
  // here too (matches mdix_files/schema/entry-note.mdix — no rich-HTML
  // field), these insert real markdown syntax at the cursor instead,
  // which actually does something. Alignment and color buttons are
  // dropped for the same reason — neither means anything in plain text.
  let { onFormat }: { onFormat: (format: string) => void } = $props();
</script>

<footer class="toolbar">
  <button onclick={() => onFormat("bold")} aria-label="Bold" title="Bold">
    <strong>B</strong>
  </button>
  <button onclick={() => onFormat("italic")} aria-label="Italic" title="Italic">
    <em>I</em>
  </button>
  <button onclick={() => onFormat("underline")} aria-label="Underline" title="Underline">
    <span class="underline">U</span>
  </button>

  <div class="sep"></div>

  <button onclick={() => onFormat("bulletList")} aria-label="Bullet list" title="Bullet list">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
    </svg>
  </button>
  <button onclick={() => onFormat("orderedList")} aria-label="Numbered list" title="Numbered list">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <text x="1" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
      <text x="1" y="14" font-size="7" fill="currentColor" stroke="none">2</text>
      <text x="1" y="20" font-size="7" fill="currentColor" stroke="none">3</text>
    </svg>
  </button>
</footer>

<style>
  .toolbar {
    height: 15vh;
    min-height: 64px;
    max-height: 96px;
    border-top: 1px solid var(--hairline);
    background: var(--surface);
    padding: 0 var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    overflow-x: auto;
  }
  .toolbar button {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .toolbar button:hover {
    background: var(--surface-raised);
  }
  .underline {
    text-decoration: underline;
  }
  .sep {
    width: 1px;
    height: 24px;
    background: var(--hairline);
    margin: 0 var(--space-1);
    flex-shrink: 0;
  }
</style>
