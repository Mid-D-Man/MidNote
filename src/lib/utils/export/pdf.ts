// Minimal PDF writer (round 30). No new dependency.
//
// WHAT IT DRAWS: text only, in the PDF standard Helvetica family (regular,
// bold, oblique, bold-oblique), which every PDF viewer has built in — so
// nothing is embedded and files stay tiny. Styling that survives: bold,
// italic, underline, strikethrough, text colour, highlight, font size, list
// markers with hanging indents, page-name headings, and "n / N" page
// numbers.
//
// THE ONE REAL LIMIT, stated plainly: standard fonts only cover Windows-1252
// (Western European Latin). Emoji and non-Latin scripts come out as "?".
// That is inherent to PDF's built-in fonts — jsPDF, pdf-lib and pdfmake all
// have it until a font file is embedded — so it is not something a library
// would have fixed here. DOCX and TXT exports are full Unicode.
//
// WRAPPING: uses the real Helvetica advance widths (pdfMetrics.ts), not
// canvas measurement, so a line that fits on screen here fits on the page in
// any viewer.
//
// FILE STRUCTURE (PDF 1.4): catalog, page tree, 4 font dictionaries, an
// info dictionary, then per page a page object + a Flate-compressed content
// stream (fflate's zlibSync), then the cross-reference table. Verified
// against real parsers in the round 30 tests (pypdf, qpdf, pdftotext,
// pdftoppm).

import { zlibSync, strToU8 } from "fflate";
import type { Block, Run } from "./blocks";
import { toWinAnsi, bytesWidth } from "./pdfMetrics";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN_X = 54;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 64;
const BODY_PT = 11;
const TITLE_PT = 20;
const HEADING_PT = 14;
const LINE_FACTOR = 1.32;
const INDENT_STEP = 18;
const PT_PER_PX = 0.75;

type FontId = 0 | 1 | 2 | 3; // regular, bold, oblique, bold-oblique
const FONT_NAMES = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"];

interface Style {
  font: FontId;
  size: number;
  color?: string;
  underline?: boolean;
  strike?: boolean;
  highlight?: string;
}

interface Tok extends Style {
  bytes: number[];
  width: number;
  space: boolean;
}

const BR = Symbol("br");
type Item = Tok | typeof BR;

const isBold = (f: FontId) => f === 1 || f === 3;

function num(n: number): string {
  return String(+n.toFixed(2));
}

function rgb(hex: string | undefined): string {
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return "0 0 0";
  const c = (i: number) => num(parseInt(hex.slice(i, i + 2), 16) / 255);
  return `${c(0)} ${c(2)} ${c(4)}`;
}

function literal(bytes: readonly number[]): string {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x5c || b === 0x28 || b === 0x29) s += "\\" + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

function styleKey(t: Style): string {
  return `${t.font}|${t.size}|${t.color ?? ""}|${t.underline ? 1 : 0}|${t.strike ? 1 : 0}|${t.highlight ?? ""}`;
}

function makeTok(bytes: number[], st: Style, space: boolean): Tok {
  return { ...st, bytes, space, width: bytesWidth(bytes, isBold(st.font), st.size) };
}

// ---- runs -> tokens -----------------------------------------------------

function runStyle(run: Run, kind: Block["kind"]): Style {
  if (kind === "title") return { font: 1, size: TITLE_PT };
  if (kind === "heading") return { font: 1, size: HEADING_PT };
  const size = run.sizePx ? Math.max(6, Math.min(72, run.sizePx * PT_PER_PX)) : BODY_PT;
  const font = ((run.bold ? 1 : 0) + (run.italic ? 2 : 0)) as FontId;
  return {
    font,
    size,
    color: run.color,
    underline: run.underline,
    strike: run.strike,
    highlight: run.highlight,
  };
}

function tokenize(runs: Run[], kind: Block["kind"]): Item[] {
  const out: Item[] = [];
  for (const run of runs) {
    const st = runStyle(run, kind);
    const lines = run.text.split("\n");
    lines.forEach((line, li) => {
      if (li > 0) out.push(BR);
      const parts = line.match(/ +|[^ ]+/g) ?? [];
      for (const part of parts) {
        const bytes = toWinAnsi(part);
        if (bytes.length) out.push(makeTok(bytes, st, part[0] === " "));
      }
    });
  }
  return out;
}

// ---- layout -------------------------------------------------------------

interface Placed {
  tok: Tok;
  x: number;
}

class Doc {
  pages: string[][] = [[]];
  y = PAGE_H - MARGIN_TOP;

  get ops(): string[] {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN_TOP;
  }

  // Make sure `height` points fit above the bottom margin; a fresh page
  // never re-breaks (a single oversize line still gets drawn).
  ensureRoom(height: number) {
    const atTop = this.y >= PAGE_H - MARGIN_TOP - 0.5;
    if (!atTop && this.y - height < MARGIN_BOTTOM) this.newPage();
  }

  drawLine(placed: Placed[], prefix: { tok: Tok; x: number } | null, minSize: number) {
    // Drop trailing spaces so a wrapped line doesn't carry an invisible tail
    // (matters for underline / highlight extents).
    while (placed.length && placed[placed.length - 1].tok.space) placed.pop();

    let maxSize = minSize;
    for (const p of placed) maxSize = Math.max(maxSize, p.tok.size);
    if (prefix) maxSize = Math.max(maxSize, prefix.tok.size);
    const lh = maxSize * LINE_FACTOR;

    this.ensureRoom(lh);
    this.y -= lh;
    const baseline = this.y + maxSize * 0.27;

    const ops = this.ops;
    const segs: Array<{ x: number; w: number; st: Style; bytes: number[] }> = [];
    for (const p of placed) {
      const last = segs[segs.length - 1];
      if (last && styleKey(last.st) === styleKey(p.tok) && Math.abs(last.x + last.w - p.x) < 0.01) {
        last.bytes = last.bytes.concat(p.tok.bytes);
        last.w += p.tok.width;
      } else segs.push({ x: p.x, w: p.tok.width, st: p.tok, bytes: p.tok.bytes.slice() });
    }
    if (prefix) segs.unshift({ x: prefix.x, w: prefix.tok.width, st: prefix.tok, bytes: prefix.tok.bytes });

    // Highlights first, so text paints over them.
    for (const s of segs) {
      if (!s.st.highlight) continue;
      ops.push(`${rgb(s.st.highlight)} rg ${num(s.x)} ${num(baseline - s.st.size * 0.22)} ${num(s.w)} ${num(s.st.size * 1.18)} re f`);
    }
    for (const s of segs) {
      ops.push(`BT /F${s.st.font + 1} ${num(s.st.size)} Tf ${rgb(s.st.color)} rg ${num(s.x)} ${num(baseline)} Td ${literal(s.bytes)} Tj ET`);
      if (s.st.underline) {
        ops.push(`${rgb(s.st.color)} RG ${num(s.st.size * 0.06)} w ${num(s.x)} ${num(baseline - s.st.size * 0.13)} m ${num(s.x + s.w)} ${num(baseline - s.st.size * 0.13)} l S`);
      }
      if (s.st.strike) {
        ops.push(`${rgb(s.st.color)} RG ${num(s.st.size * 0.06)} w ${num(s.x)} ${num(baseline + s.st.size * 0.28)} m ${num(s.x + s.w)} ${num(baseline + s.st.size * 0.28)} l S`);
      }
    }
  }

  gap(points: number) {
    if (this.y >= PAGE_H - MARGIN_TOP - 0.5) return; // never open a page with blank space
    this.y -= points;
  }
}

// Split a word wider than a whole line into pieces that each fit.
function hardSplit(tok: Tok, avail: number): Tok[] {
  const pieces: Tok[] = [];
  let cur: number[] = [];
  for (const b of tok.bytes) {
    const next = makeTok(cur.concat(b), tok, false);
    if (next.width > avail && cur.length > 0) {
      pieces.push(makeTok(cur, tok, false));
      cur = [b];
    } else cur = cur.concat(b);
  }
  if (cur.length) pieces.push(makeTok(cur, tok, false));
  return pieces;
}

function layoutBlock(doc: Doc, b: Block) {
  const level = b.level ?? 0;
  const baseSize = b.kind === "title" ? TITLE_PT : b.kind === "heading" ? HEADING_PT : BODY_PT;

  if (b.kind === "heading") doc.gap(10);

  if (b.spacer && b.runs.length === 0 && !b.prefix) {
    doc.ensureRoom(BODY_PT * LINE_FACTOR);
    doc.y -= BODY_PT * LINE_FACTOR;
    return;
  }

  const items = tokenize(b.runs, b.kind);

  // List marker: drawn hanging at the block's indent; text starts after it.
  let prefix: { tok: Tok; x: number } | null = null;
  let textX = MARGIN_X + level * INDENT_STEP + (b.prefix || level ? INDENT_STEP : 0);
  if (b.prefix) {
    const pTok = makeTok(toWinAnsi(b.prefix), { font: 0, size: BODY_PT }, false);
    prefix = { tok: pTok, x: MARGIN_X + level * INDENT_STEP };
    textX = MARGIN_X + level * INDENT_STEP + Math.max(INDENT_STEP, pTok.width + 6);
  }
  const avail = PAGE_W - MARGIN_X - textX;

  let line: Placed[] = [];
  let x = textX;
  let softWrapped = false;
  let first = true;

  const flush = () => {
    doc.drawLine(line, first ? prefix : null, baseSize);
    first = false;
    line = [];
    x = textX;
  };

  if (items.length === 0) {
    // e.g. an empty list item: still shows its marker.
    doc.drawLine([], prefix, baseSize);
  } else {
    for (const item of items) {
      if (item === BR) {
        flush();
        softWrapped = false;
        continue;
      }
      if (item.space) {
        if (line.length === 0 && softWrapped) continue; // no indent after a soft wrap
        line.push({ tok: item, x });
        x += item.width;
        continue;
      }
      const pieces = item.width > avail ? hardSplit(item, avail) : [item];
      for (const piece of pieces) {
        if (line.some((p) => !p.tok.space) && x - textX + piece.width > avail + 0.01) {
          flush();
          softWrapped = true;
        }
        line.push({ tok: piece, x });
        x += piece.width;
      }
    }
    // A trailing BR leaves nothing to draw; anything else flushes.
    if (line.length > 0) flush();
  }

  doc.gap(b.kind === "title" ? 8 : b.kind === "heading" ? 3 : b.prefix ? 1.5 : 3);
}

// ---- PDF file assembly ---------------------------------------------------

// The document title lives in the info dictionary as UTF-16BE. Control
// characters and lone surrogates (a title pasted from somewhere broken) are
// not valid there and make readers show mojibake, so they're dropped first.
function utf16beHex(s: string): string {
  const clean = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd")
    .slice(0, 200);
  let out = "FEFF";
  for (let i = 0; i < clean.length; i++) out += clean.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return out;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function buildPdf(blocks: Block[], title: string): Uint8Array {
  const doc = new Doc();
  for (const b of blocks) layoutBlock(doc, b);

  // Page numbers, now that the total is known.
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    const label = toWinAnsi(`${i + 1} / ${total}`);
    const w = bytesWidth(label, false, 9);
    ops.push(`BT /F1 9 Tf 0.5 0.5 0.5 rg ${num((PAGE_W - w) / 2)} 32 Td ${literal(label)} Tj ET`);
  });

  // Object numbering: 1 catalog, 2 page tree, 3..6 fonts, 7 info,
  // then (page, content) pairs from 8.
  const FIRST_PAGE_OBJ = 8;
  const pageObj = (i: number) => FIRST_PAGE_OBJ + i * 2;
  const bodies: Array<Uint8Array | string> = [];
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[2] = `<< /Type /Pages /Kids [${doc.pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${total} >>`;
  FONT_NAMES.forEach((name, i) => {
    bodies[3 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  });
  bodies[7] = `<< /Title <${utf16beHex(title)}> /Producer (MidNote) /Creator (MidNote) /CreationDate (${pdfDate(new Date())}) >>`;

  const fontRes = "<< /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >>";
  doc.pages.forEach((ops, i) => {
    bodies[pageObj(i)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontRes} >> /Contents ${pageObj(i) + 1} 0 R >>`;
    const compressed = zlibSync(strToU8(ops.join("\n")));
    const head = strToU8(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
    const tail = strToU8("\nendstream");
    const stream = new Uint8Array(head.length + compressed.length + tail.length);
    stream.set(head, 0);
    stream.set(compressed, head.length);
    stream.set(tail, head.length + compressed.length);
    bodies[pageObj(i) + 1] = stream;
  });

  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (u: Uint8Array) => {
    chunks.push(u);
    length += u.length;
  };
  push(strToU8("%PDF-1.4\n"));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

  const offsets: number[] = [];
  for (let n = 1; n < bodies.length; n++) {
    offsets[n] = length;
    const body = bodies[n];
    push(strToU8(`${n} 0 obj\n`));
    push(typeof body === "string" ? strToU8(body) : body);
    push(strToU8("\nendobj\n"));
  }

  const xrefAt = length;
  const count = bodies.length; // objects 1..n plus the free entry 0
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${count} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(strToU8(xref));

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
