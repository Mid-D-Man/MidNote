// Reusable long-press-vs-tap gesture detection, returned as a plain
// object of pointer-event handlers rather than a Svelte action — matches
// how Sheet.svelte and ToastItem.svelte already handle pointer gestures
// in this codebase (spread handlers directly onto an element) rather
// than introducing a new "action" pattern for just this one feature.
//
// Used for: long-press a note/todo card to enter multi-select mode.

export interface LongPressHandlers {
  onpointerdown: (e: PointerEvent) => void;
  onpointermove: (e: PointerEvent) => void;
  onpointerup: (e: PointerEvent) => void;
  onpointercancel: (e: PointerEvent) => void;
}

export interface LongPressOptions {
  onLongPress: () => void;
  onTap: () => void;
  durationMs?: number;
  moveThresholdPx?: number;
}

export function createLongPressHandlers(opts: LongPressOptions): LongPressHandlers {
  const duration = opts.durationMs ?? 500;
  const moveThreshold = opts.moveThresholdPx ?? 10;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let longPressed = false;
  // Set once movement crosses the threshold — distinct from just
  // "the long-press timer got cancelled." Without this, releasing after
  // a real scroll gesture (finger moves well past the card, timer
  // cancels, then lifts) would still count as neither a long-press NOR
  // a drag, and fall through to firing onTap — meaning scrolling the
  // list could accidentally navigate into whatever note happened to be
  // under the finger when it lifted. Confirmed this was a real bug by
  // simulating exactly that sequence before this fix, not just reasoned
  // about in the abstract.
  let moved = false;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    onpointerdown(e) {
      // Primary pointer only — ignore a second simultaneous touch, and
      // ignore non-primary mouse buttons.
      if (!e.isPrimary) return;
      longPressed = false;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      clearTimer();
      timer = setTimeout(() => {
        longPressed = true;
        timer = null;
        // Haptic feedback where supported — Android WebView exposes the
        // standard Vibration API; try/catch since some environments
        // expose the method but throw on call (e.g. permission-denied
        // contexts), and this is pure polish, never worth a crash over.
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          try {
            navigator.vibrate(30);
          } catch {
            // ignore — haptic feedback is optional polish
          }
        }
        opts.onLongPress();
      }, duration);
    },
    onpointermove(e) {
      if (moved) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > moveThreshold) {
        moved = true;
        clearTimer();
      }
    },
    onpointerup() {
      const wasLongPress = longPressed;
      const wasMove = moved;
      clearTimer();
      longPressed = false;
      moved = false;
      if (!wasLongPress && !wasMove) opts.onTap();
    },
    onpointercancel() {
      clearTimer();
      longPressed = false;
      moved = false;
    },
  };
}
