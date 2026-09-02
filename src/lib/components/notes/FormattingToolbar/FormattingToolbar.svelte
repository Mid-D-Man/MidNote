<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import FormatValuePicker from "$lib/components/notes/FormatValuePicker/FormatValuePicker.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

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
    // SECOND REVISION: back to controlling which buttons render, this
    // time deliberately rather than as leftover browser-internal state.
    // See the REVISION note below for why the "one interaction shape for
    // everything" version this replaces didn't hold up, and
    // FormatValuePicker.svelte's header comment for the <select>-specific
    // half of it.
    hasSelection?: boolean;
    fontSize?: number;
    onFontSizeChange?: (size: number) => void;
    onColorChange?: (color: string | null) => void;
    onBackgroundColorChange?: (color: string | null) => void;
    // Fired on pointerdown on anything that can open a value-style
    // picker (previously the size/color/backgroundColor <select>s
    // directly; now the single "Aa" trigger below) — the earliest point
    // available to snapshot the current Range, before whatever the tap
    // does next might disturb it. See richText.ts's
    // applyValueStyleToCapturedRange comment for why this matters: a
    // real, human-timescale gap between "open something" and "pick
    // something" is exactly the window a stray selectionchange can land
    // in and invalidate the live selection before the pick lands.
    onCaptureRange?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
  } = $props();

  // REVISION NOTE: the previous version of this file removed the
  // hasSelection-driven layout swap entirely, on the theory that three
  // rounds of fixing the two-step "open a panel, then pick from it" gap
  // meant the two-step pattern itself was the problem. That diagnosis
  // was half right: the color/backgroundColor swatch *panels* specifically
  // were real, repeat offenders, and are gone for good (see
  // FormatValuePicker.svelte). But folding hasSelection out of the
  // picture at the same time was a second, separate change bundled into
  // one "simplification," and it's the one that broke on real use:
  // - Undo/redo stayed visible and tappable while a selection was
  //   active, where they don't apply to a selection at all.
  // - B/I/U/S/size/color/background sat in the always-visible row for
  //   the no-selection ("just typing") case too, which is exactly the
  //   clutter an explicit request asked to move into the header's "..."
  //   Actions sheet instead (see NoteEditorHeader.svelte).
  // Two-step "open, then pick" and hasSelection-driven layout are
  // independent axes. This version keeps the fix for the first (no more
  // bespoke swatch panels with their own timing surface — FormatValuePicker
  // is plain content dropped into the existing, already-proven Sheet
  // component) and restores the second.
  let styleOpen = $state(false);

  // Same guard as before: stops a toolbar control from stealing focus
  // away from the note body in a way that loses its Selection.
  // preventDefault() here suppresses only the focus-stealing default
  // action of mousedown/pointerdown — click still fires normally for a
  // <button>. Deliberately NOT relied on to protect anything that isn't
  // a <button> here any more — see FormatValuePicker.svelte's header
  // comment for why a bubbled preventDefault() from a handler like this
  // one is NOT safe to lean on for a native <select>'s own default
  // action (that was the actual, confirmed cause of color/background/
  // size never responding to a tap at all), which is exactly why this
  // toolbar has no <select> elements left for it to accidentally catch.
  function guardFocus(e: Event) {
    e.preventDefault();
  }

  function apply(format: string) {
    breadcrumb(`toolbar: ${format} tapped`);
    onFormat(format);
  }

  function openStylePicker() {
    breadcrumb("toolbar: style panel opened");
    onCaptureRange?.();
    styleOpen = true;
  }
</script>

<div class="toolbar-wrap">
  <div class="toolbar" role="toolbar" aria-label="Note formatting" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
    {#if hasSelection}
      <button class:active={activeFormats.bold} onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
      <button class:active={activeFormats.italic} onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
      <button class:active={activeFormats.underline} onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
      <button class:active={activeFormats.strikethrough} onclick={() => apply("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>

      <div class="sep"></div>
    {/if}

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

    {#if hasSelection}
      <button
        class="style-trigger"
        class:active={!!activeFormats.color || !!activeFormats.backgroundColor}
        onpointerdown={openStylePicker}
        aria-label="Text size and color"
      >
        <span class="aa-icon" style="color:{activeFormats.color ?? 'inherit'}; background:{activeFormats.backgroundColor ?? 'transparent'}">Aa</span>
      </button>
    {:else}
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
    {/if}
  </div>
</div>

<Sheet bind:open={styleOpen} side="bottom" title="Text style">
  <FormatValuePicker
    {fontSize}
    onFontSizeChange={(size) => onFontSizeChange?.(size)}
    color={activeFormats.color}
    onColorChange={(c) => onColorChange?.(c)}
    backgroundColor={activeFormats.backgroundColor}
    onBackgroundColorChange={(c) => onBackgroundColorChange?.(c)}
  />
</Sheet>

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
    width: 40px;
    height: 40px;
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
  .style-trigger {
    width: auto;
    min-width: 40px;
    padding: 0 var(--space-1);
  }
  .aa-icon {
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 13px;
    padding: 3px 5px;
    border-radius: var(--radius-sm);
    line-height: 1;
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
