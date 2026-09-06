<script lang="ts">
  // Split out of the old combined FormatValuePicker, same reasoning as
  // FontSizePicker.svelte — text color and background color get their
  // own separate popups now, direct request, each with its own close
  // (X) button. This one component serves both call sites (title/
  // colors/value/onChange all passed in), since the swatch-grid markup
  // itself is identical either way — only the title, the palette, and
  // which format command it calls differ.
  let {
    title,
    colors,
    value,
    onChange,
    onClose,
  }: {
    title: string;
    colors: { label: string; value: string | null }[];
    value: string | null;
    onChange: (color: string | null) => void;
    onClose: () => void;
  } = $props();
</script>

<div class="picker-root" role="toolbar" aria-label={title} tabindex="-1">
  <div class="picker-header">
    <span class="group-label">{title}</span>
    <button type="button" class="close-btn" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
  <div class="swatch-row">
    {#each colors as c (c.label)}
      <button
        type="button"
        class="swatch"
        class:active={value === c.value}
        class:none-swatch={c.value === null}
        style={c.value ? `background:${c.value}` : undefined}
        aria-label={c.label}
        title={c.label}
        onclick={() => onChange(c.value)}
      ></button>
    {/each}
  </div>
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
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .swatch {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background: var(--surface);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .swatch.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .swatch.none-swatch {
    background: linear-gradient(45deg, transparent 47%, var(--text-faint) 47%, var(--text-faint) 53%, transparent 53%), var(--surface);
  }
</style>
