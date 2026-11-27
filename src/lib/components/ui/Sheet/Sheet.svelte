<script lang="ts">
  import type { Snippet } from "svelte";
  import { blockedByScroll, closingDistance, shouldClose, startsClosingDrag, type ScrollInfo } from "$lib/utils/sheetDrag";

  let {
    open = $bindable(false),
    side = "left",
    title = "",
    onBack,
    lift = false,
    backIcon,
    matchAppHeader = false,
    children,
  }: {
    open?: boolean;
    side?: "left" | "right" | "bottom";
    title?: string;
    // Round 42: when given, the header shows a Back arrow that calls this (the
    // caller decides where "back" goes — usually closing this sheet and
    // reopening the one it was opened from).
    onBack?: () => void;
    // Round L: a bottom sheet that floats ABOVE the bottom edge (a gap of --sheet-lift, default 64px, plus side margins and
    // rounded corners all round) instead of sitting on it. For menus whose last rows were hard to hit down at the edge of
    // the screen (where the phone's navigation bar / gesture area is). Bottom sheets only; others ignore it.
    lift?: boolean;
    /** Replaces the arrow in the Back button (e.g. the menu's cross, which is the burger icon turned over). */
    backIcon?: Snippet;
    /** A side menu whose header lines up with the app's top bar: same height, and a 36px Back button in the spot of the burger button (so the cross sits exactly where the burger was). */
    matchAppHeader?: boolean;
    children: Snippet;
  } = $props();

  // Opening and closing are animated: the sheet slides in from its edge and back out, the dim layer fades. Closing keeps the sheet
  // in the page for a moment (`closing`) so it can slide away; then it is removed.
  const EXIT_MS = 200;
  let rendered = $state(open);
  let closing = $state(false);
  $effect(() => {
    if (open) {
      rendered = true;
      closing = false;
      return;
    }
    if (!rendered) return;
    closing = true;
    const timer = setTimeout(() => {
      rendered = false;
      closing = false;
    }, EXIT_MS);
    return () => clearTimeout(timer);
  });

  // Swipe-to-close. A sheet is dragged back toward the edge it came from (down, or left/right for a side menu) and closes when it
  // is pulled far enough or flicked fast enough. The drag can start ANYWHERE on the sheet, not only on its handle: with a finger it
  // is read from touch events (so it can decide, per gesture, between closing the sheet and scrolling a list), with a mouse from
  // the handle and the header. A drag that starts on a list scrolled away from its top, or on something that scrolls sideways,
  // is left to that scrolling. The rules are in utils/sheetDrag.ts.
  let sheetEl = $state<HTMLDivElement | null>(null);
  let dragPx = $state(0);
  let dragging = $state(false);
  let grabStart = { x: 0, y: 0 };
  let grabTime = 0;
  let sheetSize = 0;

  const dragTransform = $derived(
    closing
      ? side === "bottom"
        ? "translateY(100%)"
        : side === "left"
          ? "translateX(-100%)"
          : "translateX(100%)"
      : side === "bottom"
        ? `translateY(${dragPx}px)`
        : side === "left"
          ? `translateX(${-dragPx}px)`
          : `translateX(${dragPx}px)`,
  );

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    if (shouldClose(dragPx, sheetSize, performance.now() - grabTime)) open = false;
    dragPx = 0;
  }

  // --- mouse (and any non-touch pointer): from the drag handle and the header
  function onGrabPointerDown(e: PointerEvent) {
    if (!sheetEl || e.pointerType === "touch") return; // a finger is handled by the touch events below
    // A press on the header's own buttons (Back) is a tap, not the start of a
    // swipe: capturing the pointer would swallow its click.
    if ((e.target as Element | null)?.closest("button")) return;
    dragging = true;
    dragPx = 0;
    grabStart = { x: e.clientX, y: e.clientY };
    grabTime = performance.now();
    sheetSize = side === "bottom" ? sheetEl.offsetHeight : sheetEl.offsetWidth;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function onGrabPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerType === "touch") return;
    // Only track movement in the closing direction — dragging the other
    // way just holds it at 0 (fully open), not "extra open."
    dragPx = closingDistance(side, e.clientX - grabStart.x, e.clientY - grabStart.y);
  }

  function onGrabPointerUp(e: PointerEvent) {
    if (e.pointerType === "touch") return;
    finishDrag();
  }

  // --- a finger: from anywhere on the sheet
  function scrollChain(from: EventTarget | null, root: HTMLElement): ScrollInfo[] {
    const chain: ScrollInfo[] = [];
    let el = from instanceof Element ? from : null;
    while (el && el !== root) {
      const cs = getComputedStyle(el);
      chain.push({
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
      el = el.parentElement;
    }
    return chain;
  }

  $effect(() => {
    const root = sheetEl;
    if (!root) return;
    let touch: { x: number; y: number; target: EventTarget | null; active: boolean; blocked: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touch = null;
        return;
      }
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY, target: e.target, active: false, blocked: false };
      grabTime = performance.now();
      sheetSize = side === "bottom" ? root.offsetHeight : root.offsetWidth;
    };
    const onMove = (e: TouchEvent) => {
      if (!touch || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      if (!touch.active) {
        if (touch.blocked || !startsClosingDrag(side, dx, dy)) return;
        // the gesture is toward the edge: but if it began on a list that can still scroll that way, it belongs to the list
        if (blockedByScroll(side, scrollChain(touch.target, root))) {
          touch.blocked = true;
          return;
        }
        touch.active = true;
        dragging = true;
        grabTime = performance.now();
      }
      if (e.cancelable) e.preventDefault(); // the page must not scroll while the sheet follows the finger
      dragPx = closingDistance(side, dx, dy);
    };
    const onEnd = () => {
      const was = touch?.active ?? false;
      touch = null;
      if (was) finishDrag();
    };
    const onCancel = () => {
      const was = touch?.active ?? false;
      touch = null;
      if (was) {
        dragging = false;
        dragPx = 0;
      }
    };
    // not passive: onMove has to be able to stop the page scrolling
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onCancel);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
    };
  });

  // BUGFIX: the scrim below used to call `() => (open = false)` directly,
  // with no guard at all. On a real touchscreen, the SAME tap that
  // opens a Sheet (e.g. tapping ⋮ to open CardOverflowMenu) can have its
  // trailing click land on this scrim once it's rendered — the scrim is
  // position:fixed;inset:0, so it covers the exact point that was just
  // tapped, and some WebViews deliver that gesture's click AFTER the
  // scrim has already mounted rather than strictly to the original
  // target. Symptom: the sheet visibly flashes open then immediately
  // closes on every single tap, no matter how many times you try.
  // Ignoring scrim clicks for a brief window right after opening (but
  // NOT touching the drag-to-close gesture above, which is a distinct,
  // deliberate motion) absorbs that stray trailing click without adding
  // any perceptible delay to a genuine "tap outside to dismiss" later.
  let scrimGuardActive = $state(false);
  $effect(() => {
    if (!open) return;
    scrimGuardActive = true;
    const timer = setTimeout(() => {
      scrimGuardActive = false;
    }, 300);
    return () => clearTimeout(timer);
  });

  function handleScrimClick() {
    if (scrimGuardActive) return;
    open = false;
  }
</script>

{#if rendered}
  <div class="scrim" class:closing onclick={handleScrimClick} role="presentation"></div>
  <div class="sheet {side}" class:dragging class:closing class:lifted={lift && side === "bottom"} bind:this={sheetEl} style="transform: {dragTransform}">
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
        class:match-app-header={matchAppHeader}
        role="presentation"
        onpointerdown={onGrabPointerDown}
        onpointermove={onGrabPointerMove}
        onpointerup={onGrabPointerUp}
        onpointercancel={onGrabPointerUp}
      >
        {#if onBack}
          <button type="button" class="back" aria-label="Back" onclick={() => onBack?.()}>
            {#if backIcon}
              {@render backIcon()}
            {:else}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
            {/if}
          </button>
        {/if}
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
    animation: fade-in 0.2s ease-out;
    transition: opacity 0.2s ease;
  }
  .scrim.closing {
    opacity: 0;
    pointer-events: none;
  }
  /* a sheet on its way out takes no more taps */
  .sheet.closing {
    pointer-events: none;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes slide-in-left {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }
  @keyframes slide-in-right {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .sheet {
      animation: none !important;
      transition: none !important;
    }
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
    will-change: transform;
    /* BUGFIX: a sheet always renders on its own plain --surface
       background, never on a themed entry's or the landing page's
       photo — but `position: fixed` only escapes LAYOUT, not the CSS
       cascade. A Sheet mounted anywhere under an element that set
       --theme-text-hi/-mid/-lo/--theme-tag-bg/-text inline (an app-wide
       image theme on .page, or a themed card/editor) still inherits
       those custom properties through the normal DOM tree, so anything
       inside using the var(--theme-text-hi, var(--text-hi)) fallback
       pattern (Button.svelte's ghost/outline variants, TagSelector) was
       silently picking up someone else's theme-derived color instead of
       its own intended default. `initial` here — not a specific
       redefined value — is what makes each of those consumers' own
       fallback actually take over inside any sheet, without this
       needing to know or duplicate what each one's fallback is. */
    --theme-text-hi: initial;
    --theme-text-mid: initial;
    --theme-text-lo: initial;
    --theme-tag-bg: initial;
    --theme-tag-text: initial;
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
    animation: slide-in-left 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .sheet.right {
    right: 0;
    border-left: 1px solid var(--hairline);
    animation: slide-in-right 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
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
  /* Round L: a bottom sheet lifted off the bottom edge (see the `lift` prop). The gap is at least the safe-area inset and
     --sheet-lift (64px unless a parent sets another), so the last row clears the phone's navigation bar; the height budget
     shrinks by the same gap so a tall list still fits above the status bar. */
  .sheet.bottom.lifted {
    --lift-gap: max(var(--sheet-lift, 64px), env(safe-area-inset-bottom));
    left: var(--space-3);
    right: var(--space-3);
    bottom: var(--lift-gap);
    max-height: calc(80dvh - var(--lift-gap));
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding-bottom: 0;
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
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .back {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    /* pull the arrow into the header's left padding so the title doesn't move much */
    margin: calc(-1 * var(--space-2)) 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--text-hi);
    cursor: pointer;
    touch-action: manipulation;
  }
  .back:hover {
    background: var(--surface-raised, var(--surface));
  }
  /* The top bar's burger button is 36px, 16px in from the edge, centred in a bar --app-header-height tall. The header here is
     the same bar: same height, same side padding, and the Back button with no pull-in, so its centre is the burger's centre. */
  .sheet-header.match-app-header {
    height: var(--app-header-height);
    padding: 0 var(--space-4);
  }
  .sheet-header.match-app-header .back {
    margin: 0;
  }
  .sheet-header h2 {
    font-family: var(--font-display);
    font-size: 16px;
  }
  .sheet-body {
    padding: var(--space-4);
    overflow-y: auto;
    /* a list that reaches its end stays put instead of passing the gesture on to the page behind the sheet */
    overscroll-behavior: contain;
    flex: 1;
  }
</style>
