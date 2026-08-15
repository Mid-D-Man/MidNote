<script lang="ts">
  // Deliberately limited scope, per direct request — bold/italic/
  // underline (behind one "Aa" button that opens a small panel above the
  // bar, same interaction pattern as the reference app: tap an icon, a
  // panel appears anchored above the toolbar, not covering it) plus
  // direct-action bullet/numbered lists. No color picker, no highlighter,
  // no font size — those are real features of the reference app that
  // just aren't in scope here.
  import { onMount } from "svelte";

  let { onFormat }: { onFormat: (format: string) => void } = $props();

  let stylePanelOpen = $state(false);
  let keyboardInset = $state(0);

  // Keyboard-aware positioning: without this, a `position: fixed` bar
  // sits relative to the *layout* viewport, which on some Android
  // webviews doesn't shrink when the keyboard opens — so the bar (and
  // its panel) end up rendered UNDER the keyboard instead of above it.
  // VisualViewport tracks the actually-visible area and does shrink,
  // so using its offset is what keeps this pinned just above the
  // keyboard rather than hidden behind it.
  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      keyboardInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  });

  function apply(format: string) {
    onFormat(format);
  }
</script>

<div class="toolbar-wrap" style="bottom: calc(max(var(--space-4), env(safe-area-inset-bottom)) + {keyboardInset}px)">
  {#if stylePanelOpen}
    <div class="style-panel">
      <button onclick={() => apply("bold")} aria-label="Bold"><strong>B</strong></button>
      <button onclick={() => apply("italic")} aria-label="Italic"><em>I</em></button>
      <button onclick={() => apply("underline")} aria-label="Underline"><span class="underline">U</span></button>
    </div>
  {/if}

  <footer class="toolbar">
    <button class:active={stylePanelOpen} onclick={() => (stylePanelOpen = !stylePanelOpen)} aria-label="Text style">
      <span class="aa">Aa</span>
    </button>

    <div class="sep"></div>

    <button onclick={() => apply("bulletList")} aria-label="Bullet list" title="Bullet list">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
        <line x1="9" y1="6" x2="20" y2="6" />
        <line x1="9" y1="12" x2="20" y2="12" />
        <line x1="9" y1="18" x2="20" y2="18" />
      </svg>
    </button>
    <button onclick={() => apply("orderedList")} aria-label="Numbered list" title="Numbered list">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="9" y1="6" x2="20" y2="6" />
        <line x1="9" y1="12" x2="20" y2="12" />
        <line x1="9" y1="18" x2="20" y2="18" />
        <text x="1" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
        <text x="1" y="14" font-size="7" fill="currentColor" stroke="none">2</text>
        <text x="1" y="20" font-size="7" fill="currentColor" stroke="none">3</text>
      </svg>
    </button>
  </footer>
</div>

<style>
  .toolbar-wrap {
    position: fixed;
    left: 50%;
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
  .toolbar button.active {
    background: var(--accent);
    color: var(--bg);
  }
  .aa {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 14px;
  }
  .underline {
    text-decoration: underline;
  }
  .sep {
    width: 1px;
    height: 24px;
    background: var(--hairline);
    margin: 0 var(--space-1);
    flex-shrink: 0;
  }

  .style-panel {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 44px;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface-raised);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    padding: 0 var(--space-2);
  }
  .style-panel button {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
    font-size: 14px;
  }
  .style-panel button:hover {
    background: var(--surface);
  }
</style>
