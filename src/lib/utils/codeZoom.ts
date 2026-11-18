// Reading view: how big the code is drawn. One setting for the whole phone (a reading habit, not part of any note), changed
// with the A- / A+ buttons in the bottom bar or by pinching two fingers on a code block. Pure functions only, so every rule is
// testable with plain numbers; the remembered value is in stores/readingView.svelte.ts and the pinch gesture in pinchZoom.ts.
import type { Block } from "$lib/utils/markdown";

/** The sizes A- / A+ move between. 1 is the normal size (the code is drawn at 0.84 of the note's text size). */
export const ZOOM_STEPS: readonly number[] = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.4];
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_DEFAULT = 1;

/** Any number made safe: not a number -> normal size, otherwise kept between the smallest and largest size, to 2 decimals. */
export function clampZoom(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
}

/** What was stored (text or nothing) as a size. Empty or unreadable -> normal size. */
export function parseZoom(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return ZOOM_DEFAULT;
  return clampZoom(Number(raw));
}

/** One A+ (dir 1) or A- (dir -1) tap: the next size above or below the current one, which may sit between two sizes after a pinch. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const z = clampZoom(current);
  if (dir === 1) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN;
}

/** The size while two fingers are moving: the size when they touched, scaled by how far apart they are now compared with then. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom * (distance / startDistance));
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

/** Is there a code block anywhere on the page (also inside a quote or a list)? The zoom buttons only show then. */
export function blocksHaveCode(blocks: Block[]): boolean {
  for (const b of blocks) {
    if (b.t === "code") return true;
    if ((b.t === "quote" || b.t === "section") && blocksHaveCode(b.c)) return true;
    if (b.t === "list" && b.items.some((it) => blocksHaveCode(it.c))) return true;
  }
  return false;
}
