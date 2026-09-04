<script lang="ts">
  // Pure presentational picker content — font size slider + text-color/
  // background-color swatch grids. Meant to be dropped inside whatever
  // popup the caller already has open, not a popup itself: only
  // FormattingToolbar uses this now (formatting moved back out of the
  // header's Actions sheet and into this toolbar's own anchored popups —
  // see FormattingToolbar.svelte's header comment). Deliberately has no
  // opinion on selection vs. cursor mode — the caller's callbacks just
  // call editor.chain().focus()....run() unconditionally now, since
  // Tiptap's own stored-marks handle that distinction internally. This
  // component only needs to call them.
  //
  // Older revision notes below (native <select> removal, the guardFocus/
  // preventDefault saga across rounds 1-3) describe real bugs that were
  // real at the time, in the previous execCommand-based editor. Left
  // as-is rather than deleted — the underlying lessons (ancestor
  // preventDefault can suppress a descendant native control's default
  // action; a slider needs its pointerdown default action to drag at
  // all) are still true facts about the browser, even though the specific
  // code paths they were fixing are gone with the Tiptap migration.
  // MIN_FONT_SIZE/MAX_FONT_SIZE below replace the old fixed FONT_SIZES
  // chip set now that this is a slider — a continuous range needs
  // bounds, not a discrete list, and a slider covers finer whole-number
  // steps a fixed set of 8 chips didn't.

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

  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 32;

  // SECOND REVISION: the guardFocus (preventDefault-on-pointerdown)
  // approach from the previous round is gone. It fixed B/I/U/S and the
  // swatches — buttons are fine with it, confirmed both times now — but
  // it also sat on the font-size slider, and a native <input type=range>
  // needs its own pointerdown's default action to start tracking a drag
  // at all, the same way a <select> needs its pointerdown's default
  // action to open its native picker (see this file's other REVISION
  // note, and FormattingToolbar's guardFocus comment — same underlying
  // mechanism both times, an ancestor's preventDefault suppressing a
  // descendant form control's own default behavior regardless of which
  // element the handler is actually bound to). Applying one guard
  // uniformly to a mix of buttons and a slider was the mistake: it's
  // safe for the former and breaks the latter outright, not just for
  // Android — this is standard, cross-browser pointer-event semantics
  // for native form controls, not a WebView-specific quirk this time.
  //
  // The actual problem this was protecting against — a tap stealing
  // focus from the note body, which refreshFormatState's `!within`
  // branch treats as "user left entirely" and responds to by wiping
  // pendingFormats — is now handled at the source instead: see
  // formatPickerOpen in note/[id]/+page.svelte, set true for exactly as
  // long as this component (or FormattingToolbar's equivalent popup) is
  // open, and checked by that branch before it resets anything. Doesn't
  // care whether focus moved, so it doesn't need to stop focus from
  // moving — works the same for a button tap and a slider drag.
</script>

<div class="picker-root" role="toolbar" aria-label="Text style" tabindex="-1">
<div class="picker-group">
  <span class="group-label">Text size — {fontSize}px</span>
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
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
