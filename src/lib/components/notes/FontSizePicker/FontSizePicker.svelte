<script lang="ts">
  // Split out of the old combined FormatValuePicker — direct request:
  // keep font size on its own, separate from text/background color,
  // rather than one popup holding all three. Also direct request: an
  // explicit close (X) button, since a combined popup was suspected of
  // sometimes swallowing taps ("maybe cause the popup too big") — three
  // smaller, single-purpose popups are less likely to have that problem
  // regardless, and an explicit close affordance means dismissing one
  // never depends on a tap landing exactly right on a scrim edge.
  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 32;

  let {
    fontSize,
    onFontSizeChange,
    onClose,
  }: {
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    onClose: () => void;
  } = $props();
</script>

<div class="picker-root" role="toolbar" aria-label="Text size" tabindex="-1">
  <div class="picker-header">
    <span class="group-label">Text size — {fontSize}px</span>
    <button type="button" class="close-btn" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
  <input
    type="range"
    class="size-slider"
    min={MIN_FONT_SIZE}
    max={MAX_FONT_SIZE}
    step="1"
    value={fontSize}
    oninput={(e) => onFontSizeChange(Math.round(Number((e.target as HTMLInputElement).value)))}
    aria-label="Text size"
  />
  <div class="slider-scale">
    <span>{MIN_FONT_SIZE}</span>
    <span>{MAX_FONT_SIZE}</span>
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
  .size-slider {
    width: 100%;
    height: 40px;
    accent-color: var(--accent);
  }
  .slider-scale {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-lo);
    margin-top: 2px;
  }
</style>
