<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    side = "left",
    title = "",
    children,
  }: {
    open?: boolean;
    side?: "left" | "right" | "bottom";
    title?: string;
    children: Snippet;
  } = $props();

  // Swipe-to-close. Grabbed only from the header/drag-handle, never the
  // scrollable body — so it can never fight with scrolling a long list
  // of settings/menu items, and never misfires while tapping a button
  // inside the sheet. A sheet with no title and no drag-handle (bottom
  // always has one; left/right only get one from a title) has no grab
  // region and falls back to tap-the-scrim-to-close only — true of
  // every Sheet actually used in this app today (all pass a title), so
  // this isn't a live gap, just an honest boundary if that changes.
  let sheetEl = $state<HTMLDivElement | null>(null);
  let dragPx = $state(0);
  let dragging = $state(false);
  let grabStart = { x: 0, y: 0 };
  let grabTime = 0;
  let sheetSize = 0;

  const CLOSE_DISTANCE_RATIO = 0.3;
  const CLOSE_VELOCITY_PX_MS = 0.5;

  // Which direction along the relevant axis counts as "closing," i.e.
  // back toward the edge each side slides in from.
  const closingSign = $derived(side === "left" ? -1 : 1);

  const dragTransform = $derived(
    side === "bottom" ? `translateY(${dragPx}px)` : side === "left" ? `translateX(${-dragPx}px)` : `translateX(${dragPx}px)`,
  );

  function onGrabPointerDown(e: PointerEvent) {
    if (!sheetEl) return;
    dragging = true;
    dragPx = 0;
    grabStart = { x: e.clientX, y: e.clientY };
    grabTime = performance.now();
    sheetSize = side === "bottom" ? sheetEl.offsetHeight : sheetEl.offsetWidth;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function onGrabPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const delta = side === "bottom" ? e.clientY - grabStart.y : e.clientX - grabStart.x;
    const signed = delta * closingSign;
    // Only track movement in the closing direction — dragging the other
    // way just holds it at 0 (fully open), not "extra open."
    dragPx = Math.max(0, signed);
  }

  function onGrabPointerUp() {
    if (!dragging) return;
    dragging = false;
    const elapsed = Math.max(1, performance.now() - grabTime);
    const velocity = dragPx / elapsed;
    const pastDistance = sheetSize > 0 && dragPx / sheetSize > CLOSE_DISTANCE_RATIO;
    const pastVelocity = velocity > CLOSE_VELOCITY_PX_MS;
    if (pastDistance || pastVelocity) {
      open = false;
    }
    dragPx = 0;
  }
</script>

{#if open}
  <div class="scrim" onclick={() => (open = false)} role="presentation"></div>
  <div class="sheet {side}" class:dragging bind:this={sheetEl} style="transform: {dragTransform}">
    {#if side === "bottom"}
      <div
        class="drag-handle-wrap"
        role="presentation"
        onpointerdown={onGrabPointerDown}
        onpointermove={onGrabPointerMove}
        onpointerup={onGrabPointerUp}
        onpointercancel={onGrabPointerUp}
      >
        <div class="drag-handle"></div>
      </div>
    {/if}
    {#if title}
      <div
        class="sheet-header"
        role="presentation"
        onpointerdown={onGrabPointerDown}
        onpointermove={onGrabPointerMove}
        onpointerup={onGrabPointerUp}
        onpointercancel={onGrabPointerUp}
      >
        <h2>{title}</h2>
      </div>
    {/if}
    <div class="sheet-body">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 16, 0.6);
    z-index: 40;
  }
  .sheet {
    position: fixed;
    background: var(--surface);
    border-color: var(--hairline);
    z-index: 50;
    display: flex;
    flex-direction: column;
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.4);
    transition: transform 0.2s ease;
  }
  .sheet.dragging {
    transition: none;
  }
  .sheet.left,
  .sheet.right {
    top: 0;
    bottom: 0;
    width: 280px;
    max-width: 84vw;
  }
  .sheet.left {
    left: 0;
    border-right: 1px solid var(--hairline);
  }
  .sheet.right {
    right: 0;
    border-left: 1px solid var(--hairline);
  }

  /* Bottom — modeled on the Notion reference: rises from the bottom
     edge, rounded top corners, a drag handle, max height rather than a
     fixed one so short action lists don't leave a huge empty sheet. */
  .sheet.bottom {
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 80dvh;
    border-top-left-radius: var(--radius-md);
    border-top-right-radius: var(--radius-md);
    border-top: 1px solid var(--hairline);
    padding-bottom: env(safe-area-inset-bottom);
    animation: rise 0.18s ease-out;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .drag-handle-wrap {
    flex-shrink: 0;
    padding: var(--space-3) 0 var(--space-2);
    touch-action: none;
  }
  .drag-handle {
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: var(--hairline);
    margin: 0 auto;
  }

  .sheet-header {
    padding: var(--space-4);
    border-bottom: 1px solid var(--hairline);
    flex-shrink: 0;
    touch-action: none;
  }
  .sheet-header h2 {
    font-family: var(--font-display);
    font-size: 16px;
  }
  .sheet-body {
    padding: var(--space-4);
    overflow-y: auto;
    flex: 1;
  }
</style>
