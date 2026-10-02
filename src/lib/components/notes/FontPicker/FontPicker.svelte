<script lang="ts">
  // Round 33 — the "Text font" popup of the note formatting toolbar. Same
  // single-purpose-popup shape as FontSizePicker / ColorSwatchPicker: a
  // title, its own explicit close (X) button, one job. Each entry is drawn
  // in its own face so the choice is visible before it's made.
  //
  // Imported fonts come from Settings -> Fonts; the hint at the bottom says
  // so only while there are none, so it doesn't nag once someone has some.
  import type { FontOption } from "$lib/utils/fonts";

  let {
    options,
    selectedKey,
    onChange,
    onClose,
  }: {
    options: FontOption[];
    // Which option the caret/selection is currently in (matchOption's key), or null.
    selectedKey: string | null;
    onChange: (family: string | null) => void;
    onClose: () => void;
  } = $props();

  const hasCustom = $derived(options.some((o) => o.custom));
</script>

<div class="picker-root" role="toolbar" aria-label="Font list" tabindex="-1">
  <div class="picker-header">
    <span class="group-label">Text font</span>
    <button type="button" class="close-btn" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
  <div class="font-list">
    {#each options as o (o.key)}
      <button
        type="button"
        class="font-option"
        class:active={selectedKey === o.key}
        style={o.family ? `font-family: ${o.family}` : undefined}
        aria-label={`Font ${o.label}`}
        aria-pressed={selectedKey === o.key}
        onclick={() => onChange(o.family)}
      >
        {o.label}
      </button>
    {/each}
  </div>
  {#if !hasCustom}
    <p class="hint">Add your own fonts in Settings → Fonts.</p>
  {/if}
</div>

<style>
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .group-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .close-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    cursor: pointer;
    flex-shrink: 0;
  }
  .close-btn:hover {
    background: var(--surface);
    color: var(--text-hi);
  }
  .font-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
  }
  .font-option {
    text-align: left;
    min-height: 40px;
    padding: 0 var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 16px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .font-option:hover {
    background: var(--surface);
  }
  .font-option.active {
    background: var(--accent-wash);
    border-color: var(--accent);
    color: var(--accent);
  }
  .hint {
    margin: var(--space-2) 0 0;
    font-size: 11px;
    color: var(--text-faint);
  }
</style>
