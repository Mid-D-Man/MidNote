// "Select from this text all the way to that text" for the note editor: the pure, string-side half.
// No ProseMirror, no DOM, no Svelte: the editor side (selectRangeExtension.ts) turns the document into a list of
// text blocks (one per note line, with the document position its text starts at) and gets back plain position ranges.
//
// How a range is found
//   - FROM and TO are each matched per line, exactly like find & replace (same compiler: plain text, or a full
//     JavaScript regex with the `m` flag so ^ and $ mean line start / line end). A marker therefore never spans
//     lines, but the RANGE between two markers does: it runs across as many lines as there are.
//   - Each FROM marker pairs with the nearest TO marker that starts at or after the end of the FROM marker ("first"),
//     or with the last TO marker in the page ("last"). The next range may only start after the previous one ended, so
//     the same text for both ("---" ... "---") selects the 1st-2nd, then the 3rd-4th, and never overlaps.
//   - An EMPTY FROM means "from the start of the page", an EMPTY TO "to the end of the page".
//   - includeMarkers: the selection takes in the FROM and TO text themselves (the default), or only what is between.
//   - A FROM with no TO after it simply makes no range; nothing is guessed.

import { compileFind, scanText } from "./findReplaceCore";

export interface RangeQuery {
  from: string;
  to: string;
  regex: boolean;
  caseSensitive: boolean;
  includeMarkers: boolean;
  endAt: "first" | "last";
}

/** One line of the note: `start` is the document position of its first character. */
export interface TextBlock {
  start: number;
  text: string;
}

export interface SelRange {
  from: number;
  to: number;
}

export interface RangePlan {
  ranges: SelRange[];
  /** A pattern that does not compile, already worded for the person ("Start text: Unterminated group"). */
  error: string | null;
  /** How many FROM / TO markers were found (an empty field counts as one: the page edge). */
  startCount: number;
  endCount: number;
  /** The result was cut short (too many markers/ranges, or the patterns were slow): never silently complete. */
  capped: boolean;
  timedOut: boolean;
  /** Both fields are empty: nothing to look for. */
  idle: boolean;
}

export const MAX_MARKERS = 20_000;
export const MAX_RANGES = 5_000;
export const PLAN_BUDGET_MS = 400;

const IDLE: RangePlan = { ranges: [], error: null, startCount: 0, endCount: 0, capped: false, timedOut: false, idle: true };

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface Marker {
  from: number;
  to: number;
}

function collectMarkers(
  blocks: TextBlock[],
  re: RegExp,
  deadline: number,
  now: () => number,
): { markers: Marker[]; capped: boolean; timedOut: boolean } {
  const markers: Marker[] = [];
  let capped = false;
  let timedOut = false;
  for (const b of blocks) {
    if (now() > deadline) {
      timedOut = true;
      break;
    }
    const finished = scanText(re, b.text, (m) => {
      if (markers.length >= MAX_MARKERS) {
        capped = true;
        return false;
      }
      markers.push({ from: b.start + m.index, to: b.start + m.index + m[0].length });
    });
    if (!finished) break;
  }
  return { markers, capped, timedOut };
}

export function planRanges(blocks: TextBlock[], q: RangeQuery, now: () => number = nowMs): RangePlan {
  if (!q.from && !q.to) return IDLE;

  const fromC = q.from ? compileFind({ find: q.from, regex: q.regex, caseSensitive: q.caseSensitive, wholeWord: false }) : null;
  const toC = q.to ? compileFind({ find: q.to, regex: q.regex, caseSensitive: q.caseSensitive, wholeWord: false }) : null;
  if (fromC && !fromC.re) return { ...IDLE, idle: false, error: `Start text: ${fromC.error ?? "not valid"}` };
  if (toC && !toC.re) return { ...IDLE, idle: false, error: `End text: ${toC.error ?? "not valid"}` };

  const deadline = now() + PLAN_BUDGET_MS;
  const docStart = blocks.length ? blocks[0].start : 0;
  const last = blocks.length ? blocks[blocks.length - 1] : null;
  const docEnd = last ? last.start + last.text.length : 0;

  let capped = false;
  let timedOut = false;
  let starts: Marker[];
  let ends: Marker[];
  if (fromC && fromC.re) {
    const r = collectMarkers(blocks, fromC.re, deadline, now);
    starts = r.markers;
    capped ||= r.capped;
    timedOut ||= r.timedOut;
  } else {
    starts = [{ from: docStart, to: docStart }];
  }
  if (toC && toC.re) {
    const r = collectMarkers(blocks, toC.re, deadline, now);
    ends = r.markers;
    capped ||= r.capped;
    timedOut ||= r.timedOut;
  } else {
    ends = [{ from: docEnd, to: docEnd }];
  }

  const ranges: SelRange[] = [];
  let ei = 0;
  let cursor = -1;
  for (const s of starts) {
    if (s.from < cursor) continue; // inside the range just taken: ranges never overlap
    while (ei < ends.length && ends[ei].from < s.to) ei++;
    if (ei >= ends.length) break; // no end text left after this start (so none after the later ones either)
    const e = q.endAt === "last" ? ends[ends.length - 1] : ends[ei];
    const from = q.includeMarkers ? s.from : s.to;
    const to = q.includeMarkers ? e.to : e.from;
    cursor = e.to;
    if (to <= from) continue; // nothing between two touching markers: not a range
    if (ranges.length >= MAX_RANGES) {
      capped = true;
      break;
    }
    ranges.push({ from, to });
  }
  return { ranges, error: null, startCount: starts.length, endCount: ends.length, capped, timedOut, idle: false };
}

/** The one line the bar shows under the fields. `current` is the 0-based range being previewed. */
export function describePlan(plan: RangePlan, q: RangeQuery, current: number): string {
  if (plan.idle) return "Type where to start and where to stop. Leave one empty for the start or end of the page.";
  if (plan.error) return plan.error;
  if (q.from && plan.startCount === 0) return "Start text not found";
  if (q.to && plan.endCount === 0) return "End text not found";
  if (plan.ranges.length === 0) return q.from && q.to ? "No end text after the start text" : "Nothing between them";
  const tail = plan.timedOut ? " (stopped early: slow pattern)" : plan.capped ? "+" : "";
  return `${Math.min(current, plan.ranges.length - 1) + 1} of ${plan.ranges.length}${tail}`;
}
