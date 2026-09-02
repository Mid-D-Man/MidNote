<script lang="ts">
  // Pure presentational picker content — font size chips + text-color/
  // background-color swatch grids. Meant to be dropped inside whatever
  // Sheet the caller already has open, not a Sheet itself: FormattingToolbar
  // wraps this in its own small popup for the has-selection case,
  // NoteEditorHeader embeds it directly in the existing "..." Actions
  // sheet for the no-selection case. Deliberately has no opinion on
  // WHERE the value ends up (selection vs. pending-for-next-typing) —
  // both call sites already pass in the exact same onFontSizeChange/
  // onColorChange/onBackgroundColorChange from note/[id]/+page.svelte,
  // and that page's own handlers already branch on capturedFormatRange/
  // hasSelection internally. This component just needs to call them.
  //
  // REVISION: replaces the native <select> elements that used to live
  // directly in FormattingToolbar. Two independent problems with those:
  // (1) not what was asked for ("a popup, not a dropdown") and (2) the
  // toolbar row's own guardFocus pointerdown handler — bound on the
  // *parent* .toolbar div to stop B/I/U/S buttons from stealing focus —
  // was catching every select's pointerdown too on its way up (pointerdown
  // bubbles), calling preventDefault() on it. That suppresses a <select>'s
  // native-picker-open default action even though guardFocus was never
  // attached to the select itself — confirmed directly (a small jsdom
  // script reproducing just the bubbling, since that part needs no
  // execCommand to verify): the select's own pointerdown handler ran,
  // but event.defaultPrevented was still true by the time it finished
  // bubbling. Plain <button>s here sidestep the whole category — a
  // button's click isn't gated on pointerdown's default action the way
  // a select's picker-open is, which is also why B/I/U/S kept registering
  // taps in the debug log while the color/background/size controls never
  // logged anything at all.
  import { FONT_SIZES } from "$lib/stores/settings.svelte";

  const TEXT_COLORS: { label: string; value: string | null }[] = [
    { label: "Default", value: null },
    { label: "Red", value: "#ef4444" },
    { label: "Orange", value: "#f97316" },
    { label: "Yellow", value: "#eab308" },
    { label: "Green", value: "#22c55e" },
    { label: "Teal", value: "#14b8a6" },
    { label: "Blue", value: "#3b82f6" },
    { label: "Purple", value: "#a855f7" },
  ];
  const BG_COLORS: { label: string; value: string | null }[] = [
    { label: "None", value: null },
    { label: "Red", value: "#fecaca" },
    { label: "Orange", value: "#fed7aa" },
    { label: "Yellow", value: "#fef08a" },
    { label: "Green", value: "#bbf7d0" },
    { label: "Teal", value: "#99f6e4" },
    { label: "Blue", value: "#bfdbfe" },
    { label: "Purple", value: "#e9d5ff" },
  ];

  let {
    fontSize,
    onFontSizeChange,
    color,
    onColorChange,
    backgroundColor,
    onBackgroundColorChange,
  }: {
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    color: string | null;
    onColorChange: (color: string | null) => void;
    backgroundColor: string | null;
    onBackgroundColorChange: (color: string | null) => void;
  } = $props();
</script>

<div class="picker-group">
  <span class="group-label">Text size</span>
  <div class="chip-row">
    {#each FONT_SIZES as size (size)}
      <button type="button" class="chip" class:active={fontSize === size} onclick={() => onFontSizeChange(size)}>
        {size}
      </button>
    {/each}
  </div>
</div>

<div class="picker-group">
  <span class="group-label">Text color</span>
  <div class="swatch-row">
    {#each TEXT_COLORS as c (c.label)}
      <button
        type="button"
        class="swatch"
        class:active={color === c.value}
        class:none-swatch={c.value === null}
        style={c.value ? `background:${c.value}` : undefined}
        aria-label={c.label}
        title={c.label}
        onclick={() => onColorChange(c.value)}
      ></button>
    {/each}
  </div>
</div>

<div class="picker-group">
  <span class="group-label">Background color</span>
  <div class="swatch-row">
    {#each BG_COLORS as c (c.label)}
      <button
        type="button"
        class="swatch"
        class:active={backgroundColor === c.value}
        class:none-swatch={c.value === null}
        style={c.value ? `background:${c.value}` : undefined}
        aria-label={c.label}
        title={c.label}
        onclick={() => onBackgroundColorChange(c.value)}
      ></button>
    {/each}
  </div>
</div>

<style>
  .picker-group {
    margin-bottom: var(--space-4);
  }
  .picker-group:last-child {
    margin-bottom: 0;
  }
  .group-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--space-2);
  }
  .chip-row,
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-width: 40px;
    height: 40px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--text-hi);
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
  }
  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
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
