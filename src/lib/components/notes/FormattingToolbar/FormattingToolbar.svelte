<script lang="ts">
  import { FONT_SIZES } from "$lib/stores/settings.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  // value: null means "no override" / the clear swatch.
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
    // Whether the note body currently has a real (non-collapsed) text
    // selection. Drives which row layout renders below — matches the
    // reference: selected text gets direct one-tap B/I/U/S buttons in
    // the main row; nothing selected shows the structural tools (Aa
    // submenu, lists, undo/redo) instead. The actual "applies to
    // selection vs. sets sticky state for future typing" behavior isn't
    // decided here — that's the page's handleFormat(). This prop only
    // controls which buttons are visible, not what they do.
    hasSelection?: boolean;
    fontSize?: number;
    onFontSizeChange?: (size: number) => void;
    onColorChange?: (color: string | null) => void;
    onBackgroundColorChange?: (color: string | null) => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
  } = $props();

  // Only one panel open at a time.
  let openPanel = $state<"style" | "size" | "color" | "bgColor" | null>(null);

  // Selecting/deselecting text swaps which row of buttons is shown below
  // — close whatever submenu was open rather than leave it floating
  // over a row that no longer has the button that opened it. This reads
  // hasSelection (a prop) and writes openPanel (a *different* piece of
  // state) — not the same state being read then written back, so this
  // isn't the effect_update_depth_exceeded shape documented in
  // docs/svelte5-effect-safety.md. Just a plain reset-on-prop-change.
  $effect(() => {
    hasSelection;
    openPanel = null;
  });

  // Stops a toolbar button from ever taking focus, so the contenteditable
  // note body never loses its live Selection when a button is tapped.
  // preventDefault() here suppresses only the focus-stealing default
  // action — the click event (and this component's onclick handlers)
  // still fire normally; this is standard practice for toolbar buttons
  // next to a contenteditable, not specific to this app.
  //
  // Bound to BOTH pointerdown and mousedown, not mousedown alone. On a
  // touchscreen, mousedown is a *synthesized* event fired after
  // touchstart/touchend — if the WebView resolves focus/selection state
  // off the raw touch before that synthetic mousedown ever fires,
  // preventDefault() on mousedown alone never gets a chance to stop it.
  // pointerdown is the unified pointer-events entry point for both
  // mouse and touch and fires earlier in the sequence; unlike
  // touchstart, preventDefault() on pointerdown doesn't carry the risk
  // of suppressing the click that follows, so it's a strictly-safer
  // earlier guard, not a replacement for the mousedown one. Genuinely
  // not confirmed to be THE cause of the reported "tap registers, state
  // reverts" symptom — that requires on-device confirmation like
  // everything else this WebView-specific — but it's a real gap
  // regardless of whether it's this particular bug, so it's worth
  // having either way.
  function guardFocus(e: Event) {
    e.preventDefault();
  }

  function togglePanel(panel: "style" | "size" | "color" | "bgColor") {
    breadcrumb(`toolbar: ${panel} panel toggled`);
    openPanel = openPanel === panel ? null : panel;
  }

  function apply(format: string) {
    breadcrumb(`toolbar: ${format} tapped`);
    onFormat(format);
  }

  function pickColor(value: string | null) {
    breadcrumb(`toolbar: text color -> ${value ?? "default"}`);
    onColorChange?.(value);
  }

  function pickBackgroundColor(value: string | null) {
    breadcrumb(`toolbar: background color -> ${value ?? "none"}`);
    onBackgroundColorChange?.(value);
  }
</script>

<div class="toolbar-wrap">
  {#if openPanel === "style"}
    <div class="panel" role="toolbar" aria-label="Text style" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
      <button class:active={activeFormats.bold} onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
      <button class:active={activeFormats.italic} onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
      <button class:active={activeFormats.underline} onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
      <button class:active={activeFormats.strikethrough} onclick={() => apply("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>
    </div>
  {:else if openPanel === "size"}
    <div class="panel size-panel" role="toolbar" aria-label="Text size" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
      {#each FONT_SIZES as size (size)}
        <button class:active={fontSize === size} onclick={() => onFontSizeChange?.(size)}>{size}</button>
      {/each}
    </div>
  {:else if openPanel === "color"}
    <div class="panel swatch-panel" role="toolbar" aria-label="Text color" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
      {#each TEXT_COLORS as c (c.label)}
        <button
          class="swatch"
          class:active={activeFormats.color === c.value}
          class:none-swatch={c.value === null}
          style={c.value ? `background:${c.value}` : ""}
          onclick={() => pickColor(c.value)}
          aria-label={c.label}
          title={c.label}
        ></button>
      {/each}
    </div>
  {:else if openPanel === "bgColor"}
    <div class="panel swatch-panel" role="toolbar" aria-label="Background color" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
      {#each BG_COLORS as c (c.label)}
        <button
          class="swatch"
          class:active={activeFormats.backgroundColor === c.value}
          class:none-swatch={c.value === null}
          style={c.value ? `background:${c.value}` : ""}
          onclick={() => pickBackgroundColor(c.value)}
          aria-label={c.label}
          title={c.label}
        ></button>
      {/each}
    </div>
  {/if}

  <div class="toolbar" role="toolbar" aria-label="Note formatting" tabindex="-1" onmousedown={guardFocus} onpointerdown={guardFocus}>
    {#if hasSelection}
      <button class:active={activeFormats.bold} onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
      <button class:active={activeFormats.italic} onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
      <button class:active={activeFormats.underline} onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
      <button class:active={activeFormats.strikethrough} onclick={() => apply("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>

      <div class="sep"></div>

      <button class:active={openPanel === "size"} onclick={() => togglePanel("size")} aria-label="Text size">
        <span class="tt">{fontSize}</span>
      </button>
      <button class:active={openPanel === "color"} onclick={() => togglePanel("color")} aria-label="Text color">
        <span class="color-icon">
          <span class="letter">A</span>
          <span class="bar" style="background:{activeFormats.color ?? 'currentColor'}"></span>
        </span>
      </button>
      <button class:active={openPanel === "bgColor"} onclick={() => togglePanel("bgColor")} aria-label="Background color">
        <span class="bg-icon" style="background:{activeFormats.backgroundColor ?? 'transparent'}">A</span>
      </button>
    {:else}
      <button class:active={openPanel === "style" || activeFormats.bold || activeFormats.italic || activeFormats.underline || activeFormats.strikethrough} onclick={() => togglePanel("style")} aria-label="Text style">
        <span class="aa">Aa</span>
      </button>

      <button class:active={openPanel === "size"} onclick={() => togglePanel("size")} aria-label="Text size">
        <span class="tt">{fontSize}</span>
      </button>

      <div class="sep"></div>

      <button class:active={activeFormats.list === "bullet"} onclick={() => apply("bulletList")} aria-label="Bullet list" title="Bullet list">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
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

      <button class:active={openPanel === "color"} onclick={() => togglePanel("color")} aria-label="Text color">
        <span class="color-icon">
          <span class="letter">A</span>
          <span class="bar" style="background:{activeFormats.color ?? 'currentColor'}"></span>
        </span>
      </button>
      <button class:active={openPanel === "bgColor"} onclick={() => togglePanel("bgColor")} aria-label="Background color">
        <span class="bg-icon" style="background:{activeFormats.backgroundColor ?? 'transparent'}">A</span>
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
    {/if}
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
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
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
  .aa {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 14px;
  }
  .tt {
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 12px;
  }
  .color-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }
  .color-icon .letter {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    line-height: 1;
  }
  .color-icon .bar {
    width: 16px;
    height: 3px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .bg-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 1.5px solid var(--hairline);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 12px;
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

  .panel {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 44px;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface-raised);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    padding: 0 var(--space-2);
    max-width: calc(100vw - var(--space-6));
    overflow-x: auto;
  }
  .panel button {
    flex-shrink: 0;
    min-width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
    font-size: 13px;
    padding: 0 var(--space-2);
  }
  .panel button:hover {
    background: var(--surface);
  }
  .panel button.active {
    background: var(--accent);
    color: var(--bg);
  }
  .size-panel button {
    font-family: var(--font-sans);
    font-weight: 500;
  }

  .swatch-panel {
    padding: 0 var(--space-3);
    gap: var(--space-2);
  }
  .swatch {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    min-width: 26px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background: var(--surface);
  }
  .swatch.active {
    border-color: var(--text-hi);
    box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 3px var(--accent);
  }
  .swatch.none-swatch {
    background: repeating-linear-gradient(
      45deg,
      var(--surface),
      var(--surface) 4px,
      var(--hairline) 4px,
      var(--hairline) 5px
    );
  }
</style>
