// Reusable horizontal-swipe gesture detection, same shape/convention as
// longPress.ts — a plain object of pointer-event handlers spread
// directly onto an element, not a Svelte action.
//
// Used for: swiping the landing page's content area left/right to move
// between the Notes/Todos/Boards tabs.
//
// BUGFIX (round 22): this logic was always correct, but never actually
// ran on a real touch drag. On Chromium/WebView (this app's Android
// target), a touch-driven pointer sequence over an element with no
// `touch-action` set (the default, `auto`) gets `pointercancel`'d by the
// browser almost immediately, before any meaningful dx/dy has
// accumulated, because the browser assumes it owns the gesture for
// scrolling/panning — `preventDefault()` in JS cannot stop this pre-emption
// (confirmed against real Pointer Events spec/browser-bug discussion,
// not guessed). `tracking` was getting reset to false by onpointercancel
// on basically every real swipe attempt, so onpointerup's dx/dy check
// almost never ran with real data. The actual fix is CSS, not JS: the
// element these handlers are spread onto needs `touch-action: pan-y` —
// this explicitly tells the browser "I'll handle horizontal gestures
// myself, you keep handling vertical scroll" — which stops the
// pre-emptive cancel for horizontal drags while leaving normal vertical
// list-scrolling untouched. See +page.svelte's `.swipe-area` CSS.

export interface SwipeHandlers {
  onpointerdown: (e: PointerEvent) => void;
  onpointerup: (e: PointerEvent) => void;
  onpointercancel: (e: PointerEvent) => void;
}

export interface SwipeOptions {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  // Minimum horizontal travel to count as a swipe at all — small
  // accidental drags (e.g. the tail end of a long-press on a card)
  // shouldn't change tabs.
  thresholdPx?: number;
  // How much further the gesture has to travel horizontally than
  // vertically to count as a swipe rather than a scroll. Without this, an
  // ordinary vertical scroll through the list that drifts diagonally a
  // little would trigger a tab change while someone's just trying to
  // read it.
  directionRatio?: number;
}

export function createSwipeHandlers(opts: SwipeOptions): SwipeHandlers {
  const threshold = opts.thresholdPx ?? 60;
  const ratio = opts.directionRatio ?? 1.5;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  return {
    onpointerdown(e) {
      // Primary pointer only — same reasoning as longPress.ts: ignore a
      // second simultaneous touch and non-primary mouse buttons.
      if (!e.isPrimary) return;
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    },
    onpointerup(e) {
      // Defensive, same reasoning as the isPrimary check in
      // onpointerdown: a second pointer's up/cancel shouldn't be able to
      // touch state a different (primary) pointer is mid-tracking.
      if (!e.isPrimary || !tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dx) < Math.abs(dy) * ratio) return;
      if (dx < 0) opts.onSwipeLeft();
      else opts.onSwipeRight();
    },
    onpointercancel(e) {
      if (!e.isPrimary) return;
      tracking = false;
    },
  };
}
