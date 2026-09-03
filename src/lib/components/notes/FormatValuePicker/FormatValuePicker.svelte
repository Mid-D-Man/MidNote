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
