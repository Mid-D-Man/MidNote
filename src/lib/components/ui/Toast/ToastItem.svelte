<script lang="ts">
  import { dismissToast } from "$lib/stores/toast.svelte";

  let {
    toast,
  }: {
    toast: { id: string; title: string; description?: string; variant?: string };
  } = $props();

  // Swipe left OR right to dismiss. Split into its own component (one
  // instance per toast) because each visible toast needs independent
  // drag state — a single shared "dragPx" in the parent's {#each} would
  // have every toast move together.
  //
  // Tap-to-dismiss used to be a separate onclick handler; folded into
  // this same pointer sequence instead of left alongside it, so a
  // partial drag that snaps back can never also fire a stray click-to-
  // dismiss from the same gesture — one code path decides either way.
  let dragPx = $state(0);
  let dragging = $state(false);
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let axisLocked: "x" | "y" | null = null;

  const AXIS_LOCK_THRESHOLD = 6;
  const DISMISS_DISTANCE_PX = 80;
  const DISMISS_VELOCITY_PX_MS = 0.5;

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    dragPx = 0;
    startX = e.clientX;
    startY = e.clientY;
    startTime = performance.now();
    axisLocked = null;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (axisLocked === null) {
      if (Math.abs(dx) < AXIS_LOCK_THRESHOLD && Math.abs(dy) < AXIS_LOCK_THRESHOLD) return;
      axisLocked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axisLocked === "x") dragPx = dx;
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = Math.abs(dragPx) / elapsed;
    const wasTap = axisLocked === null;
    const committedSwipe = axisLocked === "x" && (Math.abs(dragPx) > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_MS);
    if (wasTap || committedSwipe) {
      dismissToast(toast.id);
    } else {
      dragPx = 0;
    }
    axisLocked = null;
  }

  const fadeOpacity = $derived(1 - Math.min(Math.abs(dragPx) / 200, 0.7));
</script>

<div
  class="toast"
  class:destructive={toast.variant === "destructive"}
  class:dragging
  style="transform: translateX({dragPx}px); opacity: {fadeOpacity}"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={(e) => e.key === "Enter" && dismissToast(toast.id)}
  role="button"
  tabindex="0"
>
  <strong>{toast.title}</strong>
  {#if toast.description}
    <p>{toast.description}</p>
  {/if}
</div>

<style>
  .toast {
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: var(--space-3) var(--space-4);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    cursor: pointer;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
  .toast.dragging {
    transition: none;
  }
  .toast.destructive {
    border-left-color: var(--danger);
  }
  .toast strong {
    display: block;
    font-size: 13px;
    color: var(--text-hi);
  }
  .toast p {
    margin: var(--space-1) 0 0;
    font-size: 12px;
    color: var(--text-lo);
  }
</style>
