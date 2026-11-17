// A Svelte action: pinching two fingers on a code block zooms the code (the size itself comes from utils/codeZoom.ts).
// The browser's own page zoom is not used; this changes only the code, and only when BOTH fingers started on a code block, so
// scrolling and pinching over ordinary text does nothing. The size is shown live (onZoom) and remembered once, when the
// fingers lift (onEnd), not on every move.
import { pinchZoom } from "$lib/utils/codeZoom";

export interface PinchOptions {
  /** The size right now. */
  get: () => number;
  /** A new size while the fingers are moving. */
  onZoom: (zoom: number) => void;
  /** The fingers lifted after a pinch. */
  onEnd: () => void;
}

interface Point {
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

function onCode(p: Point): boolean {
  const el = p.target as { closest?: (selector: string) => unknown } | null;
  return !!el && typeof el.closest === "function" && el.closest(".code-block") !== null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function pinchOnCode(node: HTMLElement, options: PinchOptions) {
  let opts = options;
  let start: { distance: number; zoom: number } | null = null;

  function onStart(e: TouchEvent) {
    if (e.touches.length === 2 && onCode(e.touches[0]) && onCode(e.touches[1])) {
      start = { distance: distance(e.touches[0], e.touches[1]), zoom: opts.get() };
    } else if (e.touches.length > 2) {
      start = null;
    }
  }
  function onMove(e: TouchEvent) {
    if (!start || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault(); // this is a zoom, not a scroll
    opts.onZoom(pinchZoom(start.zoom, start.distance, distance(e.touches[0], e.touches[1])));
  }
  function onEnd(e: TouchEvent) {
    if (start && e.touches.length < 2) {
      start = null;
      opts.onEnd();
    }
  }

  node.addEventListener("touchstart", onStart, { passive: true });
  node.addEventListener("touchmove", onMove, { passive: false });
  node.addEventListener("touchend", onEnd, { passive: true });
  node.addEventListener("touchcancel", onEnd, { passive: true });
  return {
    update(next: PinchOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    },
  };
}
