<script lang="ts">
  import { FONT_SIZES } from "$lib/stores/settings.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let {
    onFormat,
    activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, list: null },
    hasSelection = false,
    fontSize = 15,
    onFontSizeChange,
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
    };
    // Whether the note body currently has a real (non-collapsed) text
    // selection. Drives which row layout renders below — matches the
    // reference behavior (FlyNote screenshots): selected text gets
    // direct one-tap B/I/U/S buttons in the main row; nothing selected
    // shows the structural tools (Aa submenu, lists, undo/redo)
    // instead. The actual "applies to selection vs. sets sticky state
    // for future typing" behavior isn't decided here at all — that's
    // native execCommand behavior triggered from the page's
    // handleFormat(), based on the real live selection at the moment
    // the command runs. This prop only controls which buttons are
    // visible, not what they do.
    hasSelection?: boolean;
    fontSize?: number;
    onFontSizeChange?: (size: number) => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onUndo?: () => void;
    onRedo?: () => void;
  } = $props();

  // Only one panel open at a time.
  let openPanel = $state<"style" | "size" | null>(null);

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

  // No JS-driven keyboard-avoidance here anymore — removed a
  // window.visualViewport listener that was supposed to lift this bar
  // above the on-screen keyboard but, per real-device testing, didn't
  // actually work and was one more moving part while chasing the hang
  // bug. `position: fixed` + `bottom: env(safe-area-inset-bottom)`
  // combined with app.html's `interactive-widget=resizes-content` should
  // handle this at the browser/webview level without needing JS to track
  // and react to viewport changes at all — that meta tag is specifically
  // what makes the *layout* viewport itself shrink when the keyboard
  // opens, which fixed positioning already respects on its own.

  // Stops a toolbar button from ever taking focus, so the contenteditable
  // note body never loses its live Selection when a button is tapped.
  // Without this, the execCommand/queryCommandState calls in the page's
  // handleFormat() would have nothing to act on — the contenteditable-era
  // equivalent of the lastSelStart/lastSelEnd tracking the old textarea
  // toolbar needed, except here the fix is preventing the blur outright
  // rather than tracking around it after the fact. mousedown.preventDefault()
  // suppresses only the focus-stealing default action — the click event
  // (and this component's onclick handlers) still fire normally.
  function guardFocus(e: MouseEvent) {
    e.preventDefault();
  }

  function togglePanel(panel: "style" | "size") {
    breadcrumb(`toolbar: ${panel} panel toggled`);
    openPanel = openPanel === panel ? null : panel;
  }

  function apply(format: string) {
    breadcrumb(`toolbar: ${format} tapped`);
    onFormat(format);
  }
</script>

<div class="toolbar-wrap">
  {#if openPanel === "style"}
    <div class="panel" role="toolbar" aria-label="Text style" tabindex="-1" onmousedown={guardFocus}>
      <button class:active={activeFormats.bold} onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
      <button class:active={activeFormats.italic} onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
      <button class:active={activeFormats.underline} onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
      <button class:active={activeFormats.strikethrough} onclick={() => apply("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>
    </div>
  {:else if openPanel === "size"}
    <div class="panel size-panel" role="toolbar" aria-label="Text size" tabindex="-1" onmousedown={guardFocus}>
      {#each FONT_SIZES as size (size)}
        <button class:active={fontSize === size} onclick={() => onFontSizeChange?.(size)}>{size}</button>
      {/each}
    </div>
  {/if}

  <div class="toolbar" role="toolbar" aria-label="Note formatting" tabindex="-1" onmousedown={guardFocus}>
    {#if hasSelection}
      <button class:active={activeFormats.bold} onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
      <button class:active={activeFormats.italic} onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
      <button class:active={activeFormats.underline} onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
      <button class:active={activeFormats.strikethrough} onclick={() => apply("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>

      <div class="sep"></div>

      <button class:active={openPanel === "size"} onclick={() => togglePanel("size")} aria-label="Text size">
        <span class="tt">{fontSize}</span>
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
</style>
