// Swiping a sheet (a bottom popup, the side menu) away. The rules only, plain TypeScript: components/ui/Sheet/Sheet.svelte feeds
// them touch positions and moves the sheet.
//
// A sheet closes by being dragged back toward the edge it came from: down for a bottom sheet, left for the left menu, right for a
// right one. The drag can start anywhere on the sheet, not only on its handle, so it must never fight with scrolling: a drag
// that starts on a list that is scrolled away from its top (or on something that scrolls sideways) is left to that scrolling.
export type SheetSide = "left" | "right" | "bottom";

/** The finger has to move this far before the gesture is anything at all. */
export const START_PX = 8;
/** ...and mostly toward the edge: the movement toward it must be this many times the movement across. */
export const DOMINANCE = 1.2;
/** Closed by distance: dragged past this share of the sheet's own size. */
export const CLOSE_DISTANCE_RATIO = 0.3;
/** Closed by speed: a quick flick, in pixels per millisecond. */
export const CLOSE_VELOCITY_PX_MS = 0.5;

/** How far the finger has moved toward the closing edge (negative = away from it). */
export function towardEdge(side: SheetSide, dx: number, dy: number): number {
  return side === "bottom" ? dy : side === "left" ? -dx : dx;
}

/** How far it has moved across that direction. */
function across(side: SheetSide, dx: number, dy: number): number {
  return Math.abs(side === "bottom" ? dx : dy);
}

/** Does this much movement start a closing drag? */
export function startsClosingDrag(side: SheetSide, dx: number, dy: number): boolean {
  const toward = towardEdge(side, dx, dy);
  return toward > START_PX && toward > across(side, dx, dy) * DOMINANCE;
}

/** How far the sheet follows the finger: only toward the edge, never past fully open. */
export function closingDistance(side: SheetSide, dx: number, dy: number): number {
  return Math.max(0, towardEdge(side, dx, dy));
}

/** Let go: does the sheet close? */
export function shouldClose(dragPx: number, sheetSize: number, elapsedMs: number): boolean {
  const velocity = dragPx / Math.max(1, elapsedMs);
  const pastDistance = sheetSize > 0 && dragPx / sheetSize > CLOSE_DISTANCE_RATIO;
  return pastDistance || velocity > CLOSE_VELOCITY_PX_MS;
}

/** What a scrollable thing looks like to the rules (the browser's own numbers, passed in so this stays testable). */
export interface ScrollInfo {
  overflowX: string;
  overflowY: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
}

const scrolls = (overflow: string) => overflow === "auto" || overflow === "scroll";

/**
 * Is the drag left to scrolling instead? `chain` is what the finger started on and each parent up to (not including) the sheet.
 * A bottom sheet: any vertical scroller on the way that is not at its top. A side sheet: any horizontal scroller that has
 * something to scroll. (Moving toward the edge of a bottom sheet scrolls a list back UP; only at the very top does it close.)
 */
export function blockedByScroll(side: SheetSide, chain: readonly ScrollInfo[]): boolean {
  for (const el of chain) {
    if (side === "bottom") {
      if (scrolls(el.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true;
    } else if (scrolls(el.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      return true;
    }
  }
  return false;
}
