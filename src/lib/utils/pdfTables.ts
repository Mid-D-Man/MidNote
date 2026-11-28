// Ruled tables in a PDF page. A table is not a thing in a PDF: there are only pieces of text at positions and straight lines drawn
// between them. A grid of drawn lines with text inside it is a table, so this finds the grids (lines that touch make one grid), reads
// the rows from the horizontal lines and the columns from the vertical ones, and puts each piece of text in the cell it sits in.
// Empty cells are kept (a blank form, a day with no lectures), which is what makes the columns line up. Pure functions of numbers (no
// PDF in sight), so every rule is testable. What is NOT found: a table drawn with no lines at all, or with horizontal lines only.
import type { Rule, Run } from "$lib/utils/pdfContent";
import { buildLines, cleanPdfText, runsToText } from "$lib/utils/pdfLayout";

export interface PdfTable {
  /** The grid's extent on the page. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  rows: string[][];
}

/** Lines on one axis that are this close are the same line; that close end to end they are one line (drawn in pieces). */
const SAME_LINE = 1.2;
const JOIN_GAP = 3.5;
/** A horizontal and a vertical line this close to meeting meet (thin bars are drawn a little short of the line they join). */
const TOUCH = 6;
/** Row edges / column edges this close are one edge (a double rule, a line drawn twice). */
const EDGE_MERGE = 4;
const COL_MERGE = 3;
/** A baseline sits this far under a line and still belongs to the cell above it (the line cuts through the text). */
const BASE_SLACK = 2.5;
const SPLIT_RATIO = 2.4;
const MAX_LINES = 1500;
const MAX_ROWS = 400;
const MAX_COLS = 40;

type Axis = "h" | "v";

/** Lines of one direction: pieces on one line joined, near-duplicates made one. (Input lines are as pdfContent.ts notes them.) */
export function mergeLines(lines: readonly Rule[], axis: Axis): Rule[] {
  const key = (r: Rule) => (axis === "h" ? r.y0 : r.x0);
  const lo = (r: Rule) => (axis === "h" ? r.x0 : r.y0);
  const hi = (r: Rule) => (axis === "h" ? r.x1 : r.y1);
  const sorted = lines.filter((r) => (axis === "h" ? r.y0 === r.y1 : r.x0 === r.x1)).sort((a, b) => key(a) - key(b));
  const out: Rule[] = [];
  let group: Rule[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const k = group.reduce((s, r) => s + key(r), 0) / group.length;
    const byLo = [...group].sort((a, b) => lo(a) - lo(b));
    let a = lo(byLo[0]);
    let b = hi(byLo[0]);
    const emit = () => out.push(axis === "h" ? { x0: a, y0: k, x1: b, y1: k } : { x0: k, y0: a, x1: k, y1: b });
    for (let i = 1; i < byLo.length; i++) {
      if (lo(byLo[i]) <= b + JOIN_GAP) b = Math.max(b, hi(byLo[i]));
      else {
        emit();
        a = lo(byLo[i]);
        b = hi(byLo[i]);
      }
    }
    emit();
    group = [];
  };
  for (const r of sorted) {
    if (group.length > 0 && key(r) - key(group[group.length - 1]) > SAME_LINE) flush();
    group.push(r);
  }
  flush();
  return out;
}

/** Sorted numbers -> edges: values within `tol` of the previous one become one edge (their mean). */
function clusterEdges(values: number[], tol: number): number[] {
  const v = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let group: number[] = [];
  for (const x of v) {
    if (group.length > 0 && x - group[group.length - 1] > tol) {
      out.push(group.reduce((s, n) => s + n, 0) / group.length);
      group = [];
    }
    group.push(x);
  }
  if (group.length > 0) out.push(group.reduce((s, n) => s + n, 0) / group.length);
  return out;
}

interface Grid {
  h: Rule[];
  v: Rule[];
}

/** Lines that touch are one grid. */
function grids(h: Rule[], v: Rule[]): Grid[] {
  const n = h.length + v.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < h.length; i++) {
    for (let j = 0; j < v.length; j++) {
      const a = h[i];
      const b = v[j];
      if (b.x0 >= a.x0 - TOUCH && b.x0 <= a.x1 + TOUCH && a.y0 >= b.y0 - TOUCH && a.y0 <= b.y1 + TOUCH) parent[find(i)] = find(h.length + j);
    }
  }
  const byRoot = new Map<number, Grid>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = byRoot.get(r);
    if (!g) byRoot.set(r, (g = { h: [], v: [] }));
    if (i < h.length) g.h.push(h[i]);
    else g.v.push(v[i - h.length]);
  }
  return [...byRoot.values()].filter((g) => g.h.length >= 2 && g.v.length >= 2);
}

/** Where a run's visible text starts and ends (a run's width includes the spaces a producer pads it with). */
function visible(r: Run): { x0: number; x1: number } {
  const len = Math.max(r.text.length, 1);
  const lead = r.text.length - r.text.trimStart().length;
  const trail = r.text.length - r.text.trimEnd().length;
  const w = Math.max(r.endX - r.x, 0);
  return { x0: r.x + (w * lead) / len, x1: r.endX - (w * trail) / len };
}

const hasText = (r: Run) => r.text.trim() !== "";

/** The text of the runs of one cell: lines top to bottom, left to right, joined with a space. */
function cellText(runs: Run[]): string {
  if (runs.length === 0) return "";
  const sorted = [...runs].sort((a, b) => b.y - a.y);
  const groups: Run[][] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - r.y) <= 0.5 * Math.max(r.size, g[0].size, 1)) g.push(r);
    else groups.push([r]);
  }
  const lines = groups.map((g) => buildLines(g.sort((a, b) => a.x - b.x)).map((l) => l.text.replace(/\s+/g, " ").trim()).filter((t) => t !== "").join(" "));
  return cleanPdfText(lines.filter((t) => t !== "").join(" ")).replace(/\s+/g, " ").trim();
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

/**
 * A band of the grid taller than the usual row holds several rows that no line separates (the last rows of a table drawn without
 * rules between them). Its text is cut into that many rows at the biggest gaps between the baselines of its words, and every piece of
 * text goes to the nearest of those rows (numbers sit a little above or below their row's words, so only words decide the rows).
 */
function splitBand(runs: Run[], want: number): Run[][] {
  const words = runs.filter((r) => /[A-Za-z]/.test(r.text) && r.text.trim().length >= 3);
  const anchors = words.map((r) => r.y).sort((a, b) => b - a);
  // never more rows than there are separate lines of words (the height says how many fit, the words say how many there are)
  const apart = 0.9 * Math.max(median(words.map((r) => r.size)), 1);
  const lines = 1 + anchors.slice(1).filter((y, i) => anchors[i] - y > apart).length;
  const count = Math.min(want, lines);
  if (count < 2 || anchors.length < count) return [runs];
  const gaps = anchors.slice(1).map((y, i) => ({ at: i + 1, gap: anchors[i] - y }));
  const cuts = gaps.sort((a, b) => b.gap - a.gap).slice(0, count - 1).map((g) => g.at).sort((a, b) => a - b);
  const centers: number[] = [];
  let from = 0;
  for (const cut of [...cuts, anchors.length]) {
    const part = anchors.slice(from, cut);
    centers.push(part.reduce((s, y) => s + y, 0) / part.length);
    from = cut;
  }
  const rows: Run[][] = centers.map(() => []);
  for (const r of runs) {
    let best = 0;
    for (let k = 1; k < centers.length; k++) if (Math.abs(r.y - centers[k]) < Math.abs(r.y - centers[best])) best = k;
    rows[best].push(r);
  }
  return rows;
}

/** One grid -> a table, or null when it is not one (a single box, or a grid with no text in it). */
function buildTable(g: Grid, runs: Run[]): { table: PdfTable; used: Set<Run> } | null {
  const top0 = Math.max(...g.h.map((l) => l.y0), ...g.v.map((l) => l.y1));
  const bottom0 = Math.min(...g.h.map((l) => l.y0), ...g.v.map((l) => l.y0));
  const width0 = Math.max(...g.h.map((l) => l.x1)) - Math.min(...g.h.map((l) => l.x0));
  const height0 = top0 - bottom0;
  if (width0 <= 0 || height0 <= 0) return null;
  // rows: the horizontal lines that run most of the way across (a short rule under a word is not a row edge)
  const longH = g.h.filter((l) => l.x1 - l.x0 >= 0.6 * width0);
  const rowEdges = clusterEdges(longH.map((l) => l.y0), EDGE_MERGE).sort((a, b) => b - a);
  if (rowEdges.length < 2) return null;
  // columns: the vertical lines that run a fair part of the way down
  const longV = g.v.filter((l) => l.y1 - l.y0 >= 0.25 * height0);
  let left = Math.min(...longH.map((l) => l.x0), ...longV.map((l) => l.x0));
  let right = Math.max(...longH.map((l) => l.x1), ...longV.map((l) => l.x0));
  const top = rowEdges[0];
  const bottom = rowEdges[rowEdges.length - 1];
  const inside = runs.filter((r) => {
    if (!hasText(r) || r.y < bottom - BASE_SLACK || r.y >= top - BASE_SLACK) return false;
    const x = visible(r).x0;
    return x >= left - COL_MERGE && x <= right + COL_MERGE;
  });
  // is a vertical line drawn at x on this height?
  const drawn = (x: number, y: number, tol = COL_MERGE) => longV.some((l) => Math.abs(l.x0 - x) <= tol && y >= l.y0 - 1 && y <= l.y1 + 1);
  let colEdges = clusterEdges([left, right, ...longV.map((l) => l.x0).filter((x) => x > left + COL_MERGE && x < right - COL_MERGE)], COL_MERGE);
  // a "column edge" that text is written straight across, where the line is drawn, is not one (a box side somewhere, not a column)
  const rowsCount = rowEdges.length - 1;
  colEdges = colEdges.filter((e, i) => {
    if (i === 0 || i === colEdges.length - 1) return true;
    const crossing = inside.filter((r) => {
      const v = visible(r);
      return v.x0 < e - 1.5 && v.x1 > e + 1.5 && drawn(e, r.y);
    }).length;
    return crossing <= Math.max(1, 0.1 * rowsCount);
  });
  if (colEdges.length < 3 || colEdges.length - 1 > MAX_COLS || rowEdges.length - 1 > MAX_ROWS) return null;
  left = colEdges[0];
  right = colEdges[colEdges.length - 1];
  const colOf = (x: number): number => {
    let c = 0;
    for (let k = 1; k < colEdges.length - 1; k++) if (x >= colEdges[k] - COL_MERGE) c = k;
    return c;
  };
  // each band's runs; a band much taller than the usual one holds several rows
  const bands: Run[][] = Array.from({ length: rowEdges.length - 1 }, () => []);
  for (const r of inside) {
    for (let k = 0; k < bands.length; k++) {
      if (r.y >= rowEdges[k + 1] - BASE_SLACK && r.y < rowEdges[k] - BASE_SLACK) {
        bands[k].push(r);
        break;
      }
    }
  }
  const heights = rowEdges.slice(1).map((y, k) => rowEdges[k] - y);
  const usual = median(heights.filter((_, k) => bands[k].length > 0));
  const rows: Run[][] = [];
  bands.forEach((b, k) => {
    // (a row that wraps onto a second or third line is not several rows: only a band 2.4 times the usual height or more is split)
    const ratio = usual > 0 ? heights[k] / usual : 1;
    if (ratio >= SPLIT_RATIO && b.length > 0) rows.push(...splitBand(b, Math.round(ratio)));
    else rows.push(b);
  });
  const nCols = colEdges.length - 1;
  // text that runs on across a column edge where no line is drawn (a label wider than its cell) stays together, in the cell it starts in
  const chainsOf = (rowRuns: Run[]): Run[][] => {
    const sorted = [...rowRuns].sort((a, b) => b.y - a.y);
    const lines: Run[][] = [];
    for (const r of sorted) {
      const ln = lines[lines.length - 1];
      if (ln && Math.abs(ln[0].y - r.y) <= 0.5 * Math.max(r.size, ln[0].size, 1)) ln.push(r);
      else lines.push([r]);
    }
    const chains: Run[][] = [];
    for (const ln of lines) {
      ln.sort((a, b) => a.x - b.x);
      let cur: Run[] = [];
      for (const r of ln) {
        const prev = cur[cur.length - 1];
        if (prev) {
          const gap = visible(r).x0 - visible(prev).x1;
          const wall = longV.some((l) => l.x0 > visible(prev).x1 - 1 && l.x0 < visible(r).x0 + 1 && r.y >= l.y0 - 1 && r.y <= l.y1 + 1);
          if (gap <= 0.6 * Math.max(r.size, prev.size, 1) && !wall) {
            cur.push(r);
            continue;
          }
          chains.push(cur);
          cur = [];
        }
        cur.push(r);
      }
      if (cur.length > 0) chains.push(cur);
    }
    return chains;
  };
  const cells: string[][] = rows.map((rowRuns) => {
    const per: Run[][] = Array.from({ length: nCols }, () => []);
    for (const chain of chainsOf(rowRuns)) per[colOf(visible(chain[0]).x0)].push(...chain);
    return per.map(cellText);
  });
  // drop empty columns at the edges (a frame's margin, the page space a line runs on into)
  let first = 0;
  let last = nCols - 1;
  while (first <= last && cells.every((r) => r[first] === "")) first++;
  while (last >= first && cells.every((r) => r[last] === "")) last--;
  if (last - first + 1 < 2 || cells.length < 2) return null;
  const trimmed = cells.map((r) => r.slice(first, last + 1));
  if (trimmed.reduce((n, r) => n + r.filter((c) => c !== "").length, 0) < 2) return null;
  return { table: { top, bottom, left, right, rows: trimmed }, used: new Set(inside) };
}

/** The tables of a page, top to bottom, and the runs that are in none of them. */
export function findTables(runs: Run[], rules: readonly Rule[]): { tables: PdfTable[]; loose: Run[] } {
  if (rules.length === 0) return { tables: [], loose: runs };
  const h = mergeLines(rules, "h");
  const v = mergeLines(rules, "v");
  if (h.length + v.length > MAX_LINES) return { tables: [], loose: runs };
  const found: { table: PdfTable; used: Set<Run> }[] = [];
  for (const g of grids(h, v)) {
    const t = buildTable(g, runs);
    if (t) found.push(t);
  }
  if (found.length === 0) return { tables: [], loose: runs };
  found.sort((a, b) => b.table.top - a.table.top);
  const taken = new Set<Run>();
  for (const f of found) for (const r of f.used) taken.add(r);
  return { tables: found.map((f) => f.table), loose: runs.filter((r) => !taken.has(r)) };
}

/** A table as lines of text: "| a | b | c |", an empty cell is just "|  |". (A bar inside a cell would break the row, so it becomes a slash.) */
export function tableToText(t: PdfTable): string {
  return t.rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`).join("\n");
}

/** One page: the text between and around its tables as ordinary text, each table as bar rows, in page order. */
export function pageToText(runs: Run[], rules: readonly Rule[]): string {
  const { tables, loose } = findTables(runs, rules);
  if (tables.length === 0) return runsToText(runs);
  // a loose run belongs to the stretch after the last table that is wholly above it
  const segments: Run[][] = Array.from({ length: tables.length + 1 }, () => []);
  for (const r of loose) {
    let seg = 0;
    for (let k = 0; k < tables.length; k++) if (r.y < tables[k].bottom - BASE_SLACK) seg = k + 1;
    segments[seg].push(r);
  }
  const parts: string[] = [];
  for (let k = 0; k <= tables.length; k++) {
    const t = runsToText(segments[k]).trim();
    if (t !== "") parts.push(t);
    if (k < tables.length) parts.push(tableToText(tables[k]));
  }
  return parts.join("\n\n");
}
