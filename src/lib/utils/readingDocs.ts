// Reading view, part 5: documents. A PowerPoint, PDF or Word file opened with "Open with" becomes a note holding the text that
// was read out of it (utils/pptxText.ts, pdfText.ts, docxText.ts). That text has a few conventions, and this file draws them:
//   PowerPoint: "Slide N" starts a slide; the first line is its title; indentation (two spaces a level) is the bullet level; a
//               line "a | b | c" is a table row; "Notes:" starts the speaker notes.
//   PDF:        "Page N" starts a page (only when there are several); a blank line ends a paragraph; a tab is a gap between columns.
//   Word:       one line is one paragraph; a tab is a gap between columns. Word's own styles are not in the text, so headings are
//               GUESSED (headingLevel), conservatively: a wrong guess only makes a line bold and larger.
// Everything is drawn as plain text blocks (never markup), so nothing in a file can do anything. Plain TypeScript, no DOM.
import type { Block, Inline, ListItem } from "$lib/utils/markdown";

const MAX_TABLE_COLUMNS = 40;

const text = (v: string): Inline[] => [{ t: "text", v }];
const para = (v: string): Block => ({ t: "para", c: text(v) });

/** The lines of a note's text, with the no-break spaces a note can hold turned back into spaces and the line ends trimmed. */
function linesOf(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/\s+$/, ""));
}

// ------------------------------------------------------------------------------------------------------------- tables

// A note keeps a tab as four spaces, so a gap between columns is a tab or three or more spaces.
const CELL_GAP = /\t| {3,}/;

function cellsOf(line: string): string[] {
  const t = line.trim();
  return CELL_GAP.test(t)
    ? t
        .split(CELL_GAP)
        .map((c) => c.trim())
        .filter((c) => c !== "")
    : [t];
}

const isTabular = (line: string): boolean => cellsOf(line).length >= 2;

function tableBlock(rows: string[][]): Block {
  const width = Math.min(MAX_TABLE_COLUMNS, Math.max(1, ...rows.map((r) => r.length)));
  const pad = (r: string[]): Inline[][] => Array.from({ length: width }, (_, i) => text(r[i] ?? ""));
  return { t: "table", align: Array.from({ length: width }, () => null), head: pad(rows[0]), rows: rows.slice(1).map(pad) };
}

// -------------------------------------------------------------------------------------------------------------- lists

const BULLET = /^[•◦▪▫●○■□·‣⁃*–-]\s+(\S.*)$/;
const NUMBER = /^(\d{1,3})[.)]\s+(\S.*)$/;
const RULE = /^(?:-{3,}|_{3,}|={3,}|\*{3,})$/;

interface Item {
  level: number;
  text: string;
}

/** Items with a level each -> one list, a deeper level nested under the item before it. */
function nestedList(items: Item[], ordered: boolean, start: number): Block {
  const root: ListItem[] = [];
  const stack: { level: number; items: ListItem[] }[] = [{ level: items[0].level, items: root }];
  for (const it of items) {
    let top = stack[stack.length - 1];
    if (it.level > top.level && top.items.length > 0) {
      const inner: ListItem[] = [];
      top.items[top.items.length - 1].c.push({ t: "list", ordered: false, start: 1, items: inner });
      top = { level: it.level, items: inner };
      stack.push(top);
    } else {
      while (stack.length > 1 && it.level < top.level) {
        stack.pop();
        top = stack[stack.length - 1];
      }
    }
    top.items.push({ checked: null, c: [para(it.text)] });
  }
  return { t: "list", ordered, start, items: root };
}

// ----------------------------------------------------------------------------------------------------------- headings

const MULTI_NUMBER = /^(\d{1,2}(?:\.\d{1,2})+)\.?\s+[A-Z]/; // "1.1 Scope", "2.3.1 Limits" (not "3.5 million people")
const NAMED_SECTION = /^(?:chapter|section|part|article|appendix)\s+(?:\d{1,3}|[IVXLC]{1,6}|[A-Z])\b/i;

/**
 * Is this line a heading, and of what level (0 = no)? The text of a Word or PDF file has no styles, so this goes by the shape of
 * the line: "1.1 Scope", "Chapter 3", a short ALL CAPS line, or a short line with no end punctuation that stands alone before a
 * full paragraph. Never a line that ends with . , ; : ! ? and never a long one.
 */
export function headingLevel(line: string, prevBlank: boolean, next: string | null, first: boolean): 0 | 1 | 2 | 3 | 4 {
  const len = line.length;
  if (len < 2 || len > 80 || /[.,;:!?]$/.test(line)) return 0;
  const multi = MULTI_NUMBER.exec(line);
  if (multi) return Math.min(4, 1 + multi[1].split(".").length) as 3 | 4;
  if (NAMED_SECTION.test(line)) return 2;
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && len <= 60 && line === line.toUpperCase()) return 2;
  if (
    prevBlank &&
    next !== null &&
    len <= 70 &&
    /^(?:[A-Z"“(]|\d+\S*\s+[A-Z])/.test(line) && // "2024 Annual Report" yes, "3.5 million people" no
    line.split(/\s+/).length <= 10 &&
    !isTabular(line) &&
    next.length >= 80 &&
    !BULLET.test(next) &&
    !NUMBER.test(next) &&
    !isTabular(next)
  ) {
    return first ? 1 : 2;
  }
  return 0;
}

/** A short title-like line (no end punctuation) followed by a full paragraph. */
function isLoneHeading(t: string, next: string | null): boolean {
  return (
    next !== null &&
    t.length <= 70 &&
    !/[.,;:!?]$/.test(t) &&
    /^[A-Z0-9"“(]/.test(t) &&
    t.split(/\s+/).length <= 10 &&
    next.length >= 80 &&
    !BULLET.test(next) &&
    !NUMBER.test(next) &&
    !isTabular(next)
  );
}

// ---------------------------------------------------------------------------------------------------------------- flow

/**
 * Lines -> blocks for the text of a Word or PDF file. "docx": every line is a paragraph. "pdf": the lines up to a blank line are one
 * paragraph (the layout already joined the wrapped ones, so a line break left in is a real one). Both: a run of two or more
 * lines with column gaps is a table, bullets and numbers are lists, a line of dashes is a rule.
 */
function flow(lines: string[], mode: "docx" | "pdf", headings = true): Block[] {
  const out: Block[] = [];
  const n = lines.length;
  const nextText = (from: number): string | null => {
    for (let k = from; k < n; k++) if (lines[k].trim() !== "") return lines[k].trim();
    return null;
  };
  let i = 0;
  let prevBlank = true;
  while (i < n) {
    const line = lines[i].trim();
    if (line === "") {
      prevBlank = true;
      i++;
      continue;
    }
    if (isTabular(line)) {
      const rows: string[][] = [];
      let j = i;
      while (j < n && lines[j].trim() !== "" && isTabular(lines[j].trim())) rows.push(cellsOf(lines[j++]));
      if (rows.length >= 2) {
        out.push(tableBlock(rows));
        i = j;
        prevBlank = false;
        continue;
      }
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBER.exec(line);
    if (bullet || numbered) {
      const items: Item[] = [];
      let j = i;
      while (j < n) {
        const m = (numbered ? NUMBER : BULLET).exec(lines[j].trim());
        if (!m) break;
        items.push({ level: 0, text: numbered ? m[2] : m[1] });
        j++;
      }
      // "1. Introduction" on its own, before a paragraph, is a numbered heading, not a list of one
      if (numbered && headings && items.length === 1 && isLoneHeading(numbered[2], nextText(i + 1))) {
        out.push({ t: "heading", level: 2, c: text(line) });
        i++;
        prevBlank = false;
        continue;
      }
      out.push(nestedList(items, numbered !== null, numbered ? Number(numbered[1]) : 1));
      i = j;
      prevBlank = false;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: "hr" });
      i++;
      prevBlank = true;
      continue;
    }
    if (headings) {
      const level = headingLevel(line, prevBlank, nextText(i + 1), out.length === 0);
      if (level !== 0) {
        out.push({ t: "heading", level, c: text(line) });
        i++;
        prevBlank = false;
        continue;
      }
    }
    if (mode === "docx") {
      out.push(para(line));
      i++;
      prevBlank = false;
      continue;
    }
    const parts = [line];
    let j = i + 1;
    while (j < n) {
      const t = lines[j].trim();
      if (t === "" || BULLET.test(t) || NUMBER.test(t) || isTabular(t) || RULE.test(t) || (headings && headingLevel(t, false, null, false) > 0)) break;
      parts.push(t);
      j++;
    }
    out.push(para(parts.join("\n")));
    i = j;
    prevBlank = false;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ Word

/** A Word document's text: a paragraph per line, with tables, lists and guessed headings. */
export function docxBlocks(raw: string): Block[] {
  return flow(linesOf(raw), "docx");
}

// ------------------------------------------------------------------------------------------------------------- PDF

const PAGE_MARK = /^Page (\d{1,4})$/;

/** A PDF's text: each "Page N" is a sheet (a single page has no marker and is one unlabelled sheet). */
export function pdfBlocks(raw: string): Block[] {
  const lines = linesOf(raw);
  const marks: { at: number; n: number }[] = [];
  lines.forEach((l, at) => {
    const m = PAGE_MARK.exec(l);
    if (m) marks.push({ at, n: Number(m[1]) });
  });
  if (marks.length === 0) return [{ t: "section", kind: "page", label: "", c: flow(lines, "pdf") }];
  const out: Block[] = [];
  const before = flow(lines.slice(0, marks[0].at), "pdf");
  if (before.length > 0) out.push({ t: "section", kind: "page", label: "", c: before });
  marks.forEach((mk, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].at : lines.length;
    out.push({ t: "section", kind: "page", label: `Page ${mk.n}`, c: flow(lines.slice(mk.at + 1, end), "pdf") });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------------- PowerPoint

const SLIDE_MARK = /^Slide (\d{1,4})$/;
const isPipeRow = (l: string): boolean => l.includes(" | ");
const pipeCells = (l: string): string[] => l.split(" | ").map((c) => c.trim());

/** One slide's lines (after its "Slide N" line): title, bullets, tables, then the speaker notes. */
function slideBody(lines: string[]): Block[] {
  const notesAt = lines.findIndex((l) => l === "Notes:");
  const body = notesAt >= 0 ? lines.slice(0, notesAt) : lines;
  const notes = notesAt >= 0 ? lines.slice(notesAt + 1) : [];
  const out: Block[] = [];
  let i = 0;
  while (i < body.length && body[i].trim() === "") i++;
  // the first line is the title unless it is indented, a table row or too long to be one
  if (i < body.length && !/^\s/.test(body[i]) && body[i].length <= 140 && !isPipeRow(body[i])) {
    out.push({ t: "heading", level: 3, c: text(body[i].trim()) });
    i++;
  }
  let run: Item[] = [];
  const flush = () => {
    if (run.length === 1) out.push(para(run[0].text));
    else if (run.length > 1) out.push(nestedList(run, false, 1));
    run = [];
  };
  while (i < body.length) {
    const l = body[i];
    if (l.trim() === "") {
      flush();
      i++;
    } else if (isPipeRow(l)) {
      flush();
      const rows: string[][] = [];
      while (i < body.length && isPipeRow(body[i])) rows.push(pipeCells(body[i++]));
      out.push(tableBlock(rows));
    } else {
      run.push({ level: Math.floor((l.length - l.trimStart().length) / 2), text: l.trim() });
      i++;
    }
  }
  flush();
  if (notes.some((l) => l.trim() !== "")) {
    out.push({ t: "quote", c: [{ t: "para", c: [{ t: "strong", c: text("Speaker notes") }] }, ...flow(notes, "docx", false)] });
  }
  if (out.length === 0) out.push({ t: "para", c: [{ t: "em", c: text("No text on this slide.") }] });
  return out;
}

/** A presentation's text: each "Slide N" is a card with its title, bullets, tables and speaker notes. */
export function pptxBlocks(raw: string): Block[] {
  const lines = linesOf(raw);
  const marks: { at: number; n: number }[] = [];
  lines.forEach((l, at) => {
    const m = SLIDE_MARK.exec(l);
    if (m) marks.push({ at, n: Number(m[1]) });
  });
  if (marks.length === 0) return [{ t: "section", kind: "slide", label: "", c: slideBody(lines) }];
  const out: Block[] = flow(lines.slice(0, marks[0].at), "docx", false);
  marks.forEach((mk, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].at : lines.length;
    out.push({ t: "section", kind: "slide", label: `Slide ${mk.n} of ${marks.length}`, c: slideBody(lines.slice(mk.at + 1, end)) });
  });
  return out;
}
