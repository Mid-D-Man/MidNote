<script lang="ts">
  import { FONT_SIZES } from "$lib/stores/settings.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  // value: null means "no override" / the clear option. HTML <option>
  // values are always strings, so null maps to "" and back at the call
  // sites below.
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
    onFormat,
    activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, list: null, color: null, backgroundColor: null },
    hasSelection = false,
    fontSize = 15,
    onFontSizeChange,
    onColorChange,
    onBackgroundColorChange,
    onCaptureRange,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
  }: {
    onFormat: (format: string) => void;
    activeFormats?: {
      bold: boolean;
      italic: boolean;
      underline: boolean;
      strikethrough: boolean;
      list: "bullet" | "decimal" | "roman" | null;
      color: string | null;
      backgroundColor: string | null;
    };
    // Still tells the page's handleFormat/handleFontSizeChange/
    // handleColorChange/handleBackgroundColorChange whether to apply
    // directly to a selection or set a pending (sticky-for-next-typing)
    // format — that decision hasn't changed. What HAS changed: this no
    // longer controls which buttons render.
    //
    // REVISION: this toolbar used to swap between two different row
    // layouts depending on hasSelection, with B/I/U/S hidden behind a
    // separate "Aa" panel-open tap in the no-selection layout, and
    // color/backgroundColor behind their own swatch-panel-open tap in
    // both layouts. Every one of those was a two-step "open something,
    // then pick something" interaction with a real gap in between where
    // the live selection sat exposed. Three rounds of fixes aimed at
    // that gap (collapseOutsideFormatting, pointerdown guards, captured
    // ranges) and the leak was still reported after all three — enough
    // signal that the two-step pattern itself is the problem, not a
    // specific bug in any one version of how it was defended.
    //
    // This version has exactly one interaction shape for every control:
    // pick once, done. B/I/U/S and the list buttons are plain toggle
    // buttons, always in the row, always one tap. Font size/color/
    // backgroundColor are native <select> elements — picking a value
    // fires one onchange; there's no separate app-rendered "panel" step
    // for anything to go wrong in between opening it and picking from
    // it.
    hasSelection?: boolean;
    fontSize?: number;
    onFontSizeChange?: (size: number) => void;
    onColorChange?: (color: string | null) => void;
    onBackgroundColorChange?: (color: string | null) => void;
    // Fired on pointerdown on the font-size/color/backgroundColor
    // <select> elements specifically — before focus, before the native
    // picker opens, the earliest point available to snapshot the
    // current Range. Kept from the previous version, just retargeted:
    // the captured-range apply logic was already proven correct
    // (executed directly against the real compiled code, not just
    // reasoned about) — what was fragile was the custom panel UI that
    // used to sit between "open" and "pick," not this. Dropping a
    // working safety net to match the interaction-shape simplification
    // wouldn't have made anything simpler, just less defended.
    onCaptureRange?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
  } = $props();

  // Stops a toolbar control from ever taking focus away from the note
  // body in a way that loses its Selection. preventDefault() here
  // suppresses only the focus-stealing default action of mousedown —
  // click still fires normally. Bound to both pointerdown and mousedown:
  // pointerdown fires earlier than the synthesized mousedown a
  // touchscreen produces, so it's a strictly-earlier, strictly-safer
  // version of the same guard, not a replacement for it.
  //
  // NOT applied to the font-size/color/backgroundColor <select>
  // elements — those need to take focus to open their native picker at
  // all; guarding them would just break them. Their protection is the
  // captured-range mechanism above, not this.
  function guardFocus(e: Event) {
    e.preventDefault();
  }

  function apply(format: string) {
    breadcrumb(`toolbar: ${format} tapped`);
    onFormat(format);
  }

  function pickFontSize(value: string) {
    const size = Number(value);
    breadcrumb(`toolbar: font size -> ${size}`);
    onFontSizeChange?.(size);
  }

  function pickColor(value: string) {
    breadcrumb(`toolbar: text color -> ${value || "default"}`);
    onColorChange?.(value || null);
  }

  function pickBackgroundColor(value: string) {
    breadcrumb(`toolbar: background color -> ${value || "none"}`);
    onBackgroundColorChange?.(value || null);
  }
</script>

<div class="toolbar-wrap">
  <div class="toolbar" role="toolbar" aria-label="Note formatting" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
    <button class:active={activeFormats.bold} onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
    <button class:active={activeFormats.italic} onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
    <button class:active={activeFormats.underline} onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
    <button class:active={activeFormats.strikethrough} onclick={() => apply("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>

    <div class="sep"></div>

    <select
      class="picker size-picker"
      value={String(fontSize)}
      onpointerdown={() => onCaptureRange?.()}
      onchange={(e) => pickFontSize(e.currentTarget.value)}
      aria-label="Text size"
    >
      {#each FONT_SIZES as size (size)}
        <option value={String(size)}>{size}</option>
      {/each}
    </select>

    <select
      class="picker"
      style="color:{activeFormats.color ?? 'inherit'}"
      value={activeFormats.color ?? ""}
      onpointerdown={() => onCaptureRange?.()}
      onchange={(e) => pickColor(e.currentTarget.value)}
      aria-label="Text color"
    >
      {#each TEXT_COLORS as c (c.label)}
        <option value={c.value ?? ""}>{c.label}</option>
      {/each}
    </select>

    <select
      class="picker"
      style="background:{activeFormats.backgroundColor ?? 'transparent'}"
      value={activeFormats.backgroundColor ?? ""}
      onpointerdown={() => onCaptureRange?.()}
      onchange={(e) => pickBackgroundColor(e.currentTarget.value)}
      aria-label="Background color"
    >
      {#each BG_COLORS as c (c.label)}
        <option value={c.value ?? ""}>{c.label}</option>
      {/each}
    </select>

    <div class="sep"></div>

    <button class:active={activeFormats.list === "bullet"} onclick={() => apply("bulletList")} aria-label="Bullet list" title="Bullet list">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
        <line x1="8" y1="6" x2="20" y2="6" />
        <line x1="8" y1="12" x2="20" y2="12" />
        <line x1="8" y1="18" x2="20" y2="18" />
      </svg>
    </button>
    <button class:active={activeFormats.list === "decimal"} onclick={() => apply("orderedList")} aria-label="Numbered list" title="Numbered list">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="9" y1="6" x2="20" y2="6" />
        <line x1="9" y1="12" x2="20" y2="12" />
        <line x1="9" y1="18" x2="20" y2="18" />
        <text x="1" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
        <text x="1" y="14" font-size="7" fill="currentColor" stroke="none">2</text>
        <text x="1" y="20" font-size="7" fill="currentColor" stroke="none">3</text>
      </svg>
    </button>
    <button class:active={activeFormats.list === "roman"} onclick={() => apply("romanList")} aria-label="Roman numeral list" title="Roman numeral list">
      <span class="roman-icon">iv.</span>
    </button>

    <div class="sep"></div>

    <button onclick={() => { breadcrumb("toolbar: Undo tapped"); onUndo?.(); }} disabled={!canUndo} aria-label="Undo">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 3-7" />
      </svg>
    </button>
    <button onclick={() => { breadcrumb("toolbar: Redo tapped"); onRedo?.(); }} disabled={!canRedo} aria-label="Redo">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 7v6h-6" /><path d="M21 13a9 9 0 1 1-3-7" />
      </svg>
    </button>
  </div>
</div>

<style>
  .toolbar-wrap {
    position: fixed;
    left: 50%;
    bottom: max(var(--space-4), env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    justify-content: center;
  }
  .toolbar {
    height: 52px;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface-raised);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    padding: 0 var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: calc(100vw - var(--space-6));
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
    background: var(--surface);
  }
  .toolbar button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .toolbar button.active {
    background: var(--accent);
    color: var(--bg);
  }
  /* Native <select> — deliberately minimal styling. The whole point is
     that the OS renders and manages the actual picker; fighting that
     with heavy custom CSS would be working against the reason this
     exists. Sized to roughly match the toggle buttons alongside it and
     left otherwise close to platform default. */
  .picker {
    flex-shrink: 0;
    height: 36px;
    max-width: 72px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-hi);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    padding: 0 var(--space-1);
  }
  .size-picker {
    max-width: 52px;
    text-align: center;
  }
  .roman-icon {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 600;
  }
  .underline {
    text-decoration: underline;
  }
  .strike {
    text-decoration: line-through;
  }
  .sep {
    width: 1px;
    height: 24px;
    background: var(--hairline);
    margin: 0 var(--space-1);
    flex-shrink: 0;
  }
</style>
