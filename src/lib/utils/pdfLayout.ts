// Positioned runs of text -> readable text. A PDF knows where each piece of text goes on the page, not what a line or a paragraph is,
// so this works that out from the positions (pure functions, no PDF in sight, so every rule is testable with plain numbers):
//   - runs at about the same height are one LINE; a gap between them is a space, a big gap a tab (a table column)
//   - a line that stopped only because the next word would not fit, followed by a normally spaced line of the same size, is the SAME
//     paragraph, joined into one line (so the note reflows to the phone's width instead of keeping the PDF's line breaks); anything else
//     (a short line, a heading, a list item, an indented first line, a table row, a bigger gap) starts a new line or paragraph
//   - text drawn twice at almost the same spot (fake bold) is kept once
// The order is the order the PDF draws things in, which for ordinary documents is reading order, column by column.
import type { Run } from "$lib/utils/pdfContent";

export interface Line {
  y: number;
  size: number;
  x0: number;
  x1: number;
  text: string;
}

/**
 * Word processors write bullets and ticks in symbol fonts, and the text map then gives characters from the Private Use Area (U+E000..).
 * The common ones are turned into the real character, any other private-use character is dropped (it would show as an empty box).
 */
export function fixPrivateUse(text: string): string {
  return text.replace(/[\ue000-\uf8ff]/g, (c) => {
    switch (c) {
      case "\uf0b7": case "\uf0a7": case "\uf076": case "\uf0a8": case "\uf06e": case "\uf071": case "\uf0d8": return "\u2022";
      case "\uf0fc": case "\uf0fb": return "\u2713";
      case "\uf0e0": case "\uf0f0": case "\uf0e8": return "\u2192";
      default: return "";
    }
  });
}

export function buildLines(runs: Run[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let prev: Run | null = null;
  for (const r0 of runs) {
    const r = /[\ue000-\uf8ff]/.test(r0.text) ? { ...r0, text: fixPrivateUse(r0.text) } : r0;
    if (r.text === "") continue;
    const tol = 0.5 * Math.max(r.size, cur ? cur.size : 0, 1);
    if (cur && Math.abs(r.y - cur.y) <= tol) {
      if (prev && r.text === prev.text && Math.abs(r.x - prev.x) < 0.5 * Math.max(r.size, 1) && Math.abs(r.y - prev.y) < tol) continue; // fake bold
      const gap = r.x - cur.x1;
      let sep = "";
      if (gap > 2.5 * r.size) sep = "\t";
      else if (gap > 0.2 * r.size || gap < -r.size) sep = " ";
      if (sep !== "" && !/[ \t]$/.test(cur.text) && !/^[ \t]/.test(r.text)) cur.text += sep;
      cur.text += r.text;
      cur.x1 = Math.max(r.endX, r.x);
      cur.size = Math.max(cur.size, r.size);
    } else {
      cur = { y: r.y, size: r.size, x0: r.x, x1: Math.max(r.endX, r.x), text: r.text };
      lines.push(cur);
    }
    prev = r;
  }
  for (const l of lines) l.text = l.text.replace(/[ \t]+$/, "");
  return lines.filter((l) => l.text.trim() !== "");
}

const LIST_ITEM = /^(?:[\u2022\u25cf\u25aa\u25e6\u2013\u2014*\-]\s|\(?\d{1,3}[.)]\s|\(?[a-zA-Z][.)]\s|[IVXivx]{1,5}[.)]\s)/;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/** The lines of ONE page as text. */
export function linesToText(lines: Line[]): string {
  if (lines.length === 0) return "";

  // COLUMNS: lines whose left edges are close together are one column (the left margin of each is where its lines start)
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const typical = Math.max(sizes[Math.floor(sizes.length / 2)], 1);
  const byLeft = lines.map((_, i) => i).sort((a, b) => lines[a].x0 - lines[b].x0);
  const column: number[] = new Array(lines.length).fill(0);
  let id = 0;
  let lastX = Number.NEGATIVE_INFINITY;
  for (const i of byLeft) {
    if (lastX !== Number.NEGATIVE_INFINITY && lines[i].x0 - lastX > 3 * typical) id++;
    column[i] = id;
    lastX = lines[i].x0;
  }
  const lefts: number[] = [];
  for (let c = 0; c <= id; c++) {
    const xs = lines.filter((_, i) => column[i] === c).map((l) => l.x0).sort((a, b) => a - b);
    lefts.push(percentile(xs, 0.1));
  }
  // BLOCKS: runs of lines of one column spaced like consecutive lines of a paragraph (a heading, a paragraph gap or the next column
  // starts a new block). The right edge of a block is the furthest any of its long lines reaches, so a narrow column inside a
  // full-width page, or a quote set in from the margin, has its own edge. A block with too few long lines to judge borrows the
  // column's edge; with nothing to go on the edge is infinity, which means no joining.
  const isLong = (l: Line) => l.text.length >= 20 && !l.text.includes("\t");
  const edgeOf = (idx: number[]): number => {
    const longs = idx.filter((k) => isLong(lines[k]));
    if (longs.length < 3) return Number.POSITIVE_INFINITY;
    const edge = Math.max(...longs.map((k) => lines[k].x1));
    const left = Math.min(...longs.map((k) => lines[k].x0));
    // an edge counts only if more than one line reaches it: in a list the longest item alone would set the edge and then look "full"
    const reaching = longs.filter((k) => lines[k].x1 >= edge - 0.1 * (edge - left)).length;
    return reaching >= 2 ? edge : Number.POSITIVE_INFINITY;
  };
  const block: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    const together = column[i] === column[i - 1] && Math.abs(lines[i - 1].y - lines[i].y) <= 1.7 * Math.max(lines[i - 1].size, lines[i].size, 1);
    block.push(together ? block[i - 1] : block[i - 1] + 1);
  }
  const columnEdge = new Map<number, number>();
  for (let c = 0; c <= id; c++) columnEdge.set(c, edgeOf(lines.map((_, k) => k).filter((k) => column[k] === c)));
  const blockEdge = new Map<number, number>();
  for (let bId = 0; bId <= block[lines.length - 1]; bId++) {
    const idx = lines.map((_, k) => k).filter((k) => block[k] === bId);
    const own = edgeOf(idx);
    blockEdge.set(bId, Number.isFinite(own) ? own : (columnEdge.get(column[idx[0]]) ?? Number.POSITIVE_INFINITY));
  }
  const localRight = (i: number): number => blockEdge.get(block[i]) ?? Number.POSITIVE_INFINITY;

  let out = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1];
    const l = lines[i];
    const gapY = Math.abs(p.y - l.y);
    const maxSize = Math.max(p.size, l.size, 1);
    if (gapY > 1.7 * maxSize) {
      out += "\n\n" + l.text; // a paragraph gap (or the next column starting)
      continue;
    }
    const left = lefts[column[i - 1]];
    const right = localRight(i - 1);
    const sameSize = Math.abs(p.size - l.size) <= 0.2 * Math.max(p.size, 1);
    // WRAPPED: the line stopped because the next word would not fit (justified text runs to the edge; left-aligned text stops short
    // by less than the next word is wide)
    const nextWord = /^\S+/.exec(l.text)?.[0] ?? "";
    const charWidth = (l.x1 - l.x0) / Math.max(l.text.length, 1);
    const wrapped = Number.isFinite(right) && right > p.x0 && right - p.x1 < nextWord.length * charWidth * 1.05 + 0.3 * maxSize;
    const indented = l.x0 - left > 1.2 * maxSize && p.x0 - left <= 0.6 * maxSize;
    const tabular = p.text.includes("\t") || l.text.includes("\t");
    if (column[i - 1] === column[i] && wrapped && sameSize && !indented && !tabular && !LIST_ITEM.test(l.text) && l.y < p.y + 0.5 * maxSize) {
      out += /-$/.test(p.text) && /^[a-z\u00df-\u00ff]/.test(l.text) ? l.text : " " + l.text;
    } else {
      out += "\n" + l.text;
    }
  }
  return out;
}

/** Cleans text that came out of a PDF: ligature characters spelled out, odd spaces and control characters removed. */
export function cleanPdfText(s: string): string {
  return s
    .replace(/\ufb00/g, "ff").replace(/\ufb01/g, "fi").replace(/\ufb02/g, "fl").replace(/\ufb03/g, "ffi").replace(/\ufb04/g, "ffl").replace(/\ufb05/g, "st").replace(/\ufb06/g, "st")
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff\ufffd]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ ]{2,}/g, " ");
}

export function runsToText(runs: Run[]): string {
  return cleanPdfText(linesToText(buildLines(runs)));
}
