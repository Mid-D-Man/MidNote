// Neutral document model for "Export as" (round 30).
//
// A note is stored as HTML (Tiptap's output: one <div> per line, <ul>/<ol>
// lists, task lists, and <span style> runs for colour / size / highlight).
// DOCX and PDF need that as *structure*, not markup, so both writers
// consume the small model below instead of each re-parsing HTML:
//
//   Block  = one paragraph (title, heading, ordinary line, list item, or
//            an empty line)
//   Run    = a stretch of text inside a block sharing one style
//
// Deliberately no images, tables or fonts: the editor can't produce any of
// them, so the model has nothing to carry. If the editor ever grows one,
// this is the single place it gets added and both writers pick it up.
//
// Comments are NOT part of an export. They are private margin notes on the
// entry, not part of the document someone would hand to another person.

import type { Entry } from "$lib/types/entry";
import { entryToPlainText } from "$lib/utils/selectionActions";

export interface Run {
  text: string; // may contain "\n" (a Shift+Enter hard break inside the paragraph)
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string; // "rrggbb", no "#"
  highlight?: string; // "rrggbb"
  sizePx?: number; // the editor's own unit (font-size in px)
}

export type BlockKind = "title" | "heading" | "para";

export interface Block {
  kind: BlockKind;
  runs: Run[];
  // List marker drawn once, hanging to the left of the text ("•", "2.",
  // "iv.", "[ ]", "[x]"). No trailing space — each writer spaces it.
  prefix?: string;
  // Nesting depth for list items (0 = top level).
  level?: number;
  // An empty line the user left on purpose (an empty <div>).
  spacer?: boolean;
}

// ---- small parsers ------------------------------------------------------

const NAMED: Record<string, string> = {
  black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff",
  yellow: "ffff00", orange: "ffa500", purple: "800080", gray: "808080", grey: "808080",
};

/** "#abc" / "#aabbcc" / "rgb(1,2,3)" / "rgba(...)" / a few names -> "rrggbb". */
export function parseColor(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const v = input.trim().toLowerCase();
  if (!v || v === "transparent" || v === "inherit" || v === "initial") return undefined;
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split("").map((c) => c + c).join("");
  m = v.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return m[1];
  m = v.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+(\d*\.?\d+%?))?\s*\)$/);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha === 0) return undefined; // fully transparent = "no colour"
    const to = (s: string) => Math.max(0, Math.min(255, Math.round(parseFloat(s)))).toString(16).padStart(2, "0");
    return to(m[1]) + to(m[2]) + to(m[3]);
  }
  return undefined;
}

/** "18px" -> 18, "12pt" -> 16 (px); anything else undefined. */
export function parseSizePx(input: string | null | undefined): number | undefined {
  if (!input) return undefined;
  const m = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(px|pt)$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const px = m[2] === "pt" ? (n * 4) / 3 : n;
  return px > 0 && px < 400 ? px : undefined;
}

const ROMAN: Array<[number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];
export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

// ---- HTML -> blocks -----------------------------------------------------

interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  highlight?: string;
  sizePx?: number;
}

function withElementMarks(el: Element, inherited: Marks): Marks {
  const m: Marks = { ...inherited };
  const tag = el.tagName.toLowerCase();
  if (tag === "strong" || tag === "b") m.bold = true;
  if (tag === "em" || tag === "i") m.italic = true;
  if (tag === "u") m.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") m.strike = true;
  const style = (el as HTMLElement).style;
  if (style) {
    const color = parseColor(style.color);
    if (color) m.color = color;
    const bg = parseColor(style.backgroundColor);
    if (bg) m.highlight = bg;
    const size = parseSizePx(style.fontSize);
    if (size) m.sizePx = size;
    if (style.fontWeight === "bold" || Number(style.fontWeight) >= 600) m.bold = true;
    if (style.fontStyle === "italic") m.italic = true;
    const deco = style.textDecoration || "";
    if (deco.includes("underline")) m.underline = true;
    if (deco.includes("line-through")) m.strike = true;
  }
  return m;
}

function pushRun(runs: Run[], text: string, marks: Marks) {
  if (!text) return;
  const run: Run = { text };
  if (marks.bold) run.bold = true;
  if (marks.italic) run.italic = true;
  if (marks.underline) run.underline = true;
  if (marks.strike) run.strike = true;
  if (marks.color) run.color = marks.color;
  if (marks.highlight) run.highlight = marks.highlight;
  if (marks.sizePx) run.sizePx = marks.sizePx;
  const last = runs[runs.length - 1];
  // Merge neighbours with identical styling so a word that ProseMirror
  // split into several text nodes stays one run.
  if (last && sameStyle(last, run)) last.text += text;
  else runs.push(run);
}

function sameStyle(a: Run, b: Run): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike &&
    a.color === b.color && a.highlight === b.highlight && a.sizePx === b.sizePx;
}

const BLOCK_TAGS = new Set(["div", "p", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);

/** One child node's inline contribution, skipping nested block containers and checkbox labels. */
function inlineNode(child: Node, marks: Marks, runs: Run[]) {
  if (child.nodeType === 3) {
    pushRun(runs, (child.textContent ?? "").replace(/\u00a0/g, " "), marks);
    return;
  }
  if (child.nodeType !== 1) return;
  const el = child as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") { pushRun(runs, "\n", marks); return; }
  if (tag === "label" || tag === "input") return; // Tiptap's checkbox node view
  if (BLOCK_TAGS.has(tag)) return; // handled by the block walker
  const inner = withElementMarks(el, marks);
  el.childNodes.forEach((c) => inlineNode(c, inner, runs));
}

function collectInline(node: Node, marks: Marks, runs: Run[]) {
  node.childNodes.forEach((c) => inlineNode(c, marks, runs));
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));
}

function trimTrailingBreak(runs: Run[]) {
  // A <div>text<br></div> (Tiptap's empty-line placeholder) ends in a lone
  // "\n" that is not a real second line.
  const last = runs[runs.length - 1];
  if (last && last.text.endsWith("\n")) {
    last.text = last.text.slice(0, -1);
    if (!last.text) runs.pop();
  }
}

function paragraphBlock(el: Element, marks: Marks, extra: Partial<Block> = {}): Block {
  const runs: Run[] = [];
  collectInline(el, withElementMarks(el, marks), runs);
  trimTrailingBreak(runs);
  const empty = runs.every((r) => !r.text.trim());
  if (empty && !extra.prefix) return { kind: "para", runs: [], spacer: true, ...extra };
  return { kind: "para", runs, ...extra };
}

function walkBlocks(parent: Node, marks: Marks, level: number, out: Block[]) {
  parent.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? "").trim();
      if (t) out.push({ kind: "para", runs: [{ text: t }] });
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "ul" || tag === "ol") {
      walkList(el, marks, level, out);
      return;
    }
    if (tag === "div" || tag === "p" || /^h[1-6]$/.test(tag) || tag === "blockquote" || tag === "pre") {
      if (hasBlockChild(el)) {
        // A wrapper around more blocks: descend, don't flatten.
        walkBlocks(el, withElementMarks(el, marks), level, out);
      } else {
        const b = paragraphBlock(el, /^h[1-6]$/.test(tag) ? { ...marks, bold: true } : marks);
        if (level > 0 && !b.spacer) b.level = level;
        out.push(b);
      }
      return;
    }
    // Stray inline content at the top level (very old notes).
    const runs: Run[] = [];
    inlineNode(el, marks, runs);
    if (runs.some((r) => r.text.trim())) out.push({ kind: "para", runs });
  });
}

function walkList(list: Element, marks: Marks, level: number, out: Block[]) {
  const tag = list.tagName.toLowerCase();
  const isTask = list.getAttribute("data-type") === "taskList";
  const roman = tag === "ol" && (list.getAttribute("type") || "").toLowerCase() === "i";
  let counter = tag === "ol" ? parseInt(list.getAttribute("start") || "1", 10) || 1 : 0;

  Array.from(list.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== "li") return;
    let prefix: string;
    if (isTask) prefix = li.getAttribute("data-checked") === "true" ? "[x]" : "[ ]";
    else if (tag === "ol") prefix = `${roman ? toRoman(counter) : counter}.`;
    else prefix = level === 0 ? "\u2022" : "\u2013"; // • then – (both are in WinAnsi)
    counter++;

    // An item's text can sit directly in the <li>, or in one or more
    // <div>/<p> children (our DivParagraph), with nested lists after.
    const paragraphs: Element[] = [];
    const nested: Element[] = [];
    const direct: Node[] = [];
    li.childNodes.forEach((c) => {
      if (c.nodeType === 1) {
        const ct = (c as Element).tagName.toLowerCase();
        if (ct === "ul" || ct === "ol") nested.push(c as Element);
        else if (ct === "div" || ct === "p") {
          // Tiptap's task item wraps its paragraphs in one more <div>.
          if (hasBlockChild(c as Element)) {
            Array.from((c as Element).children).forEach((cc) => {
              const cct = cc.tagName.toLowerCase();
              if (cct === "ul" || cct === "ol") nested.push(cc);
              else paragraphs.push(cc);
            });
          } else paragraphs.push(c as Element);
        } else if (ct !== "label") direct.push(c);
      } else direct.push(c);
    });

    let first = true;
    const emit = (b: Block) => {
      if (first) { b.prefix = prefix; first = false; }
      b.level = level;
      b.spacer = false;
      out.push(b);
    };
    if (direct.length && direct.some((n) => (n.textContent ?? "").trim())) {
      const runs: Run[] = [];
      direct.forEach((n) => inlineNode(n, marks, runs));
      emit({ kind: "para", runs });
    }
    paragraphs.forEach((p) => {
      const b = paragraphBlock(p, marks);
      if (b.spacer && !first) return; // ignore empty continuation paragraphs
      emit({ ...b, spacer: false });
    });
    if (first) emit({ kind: "para", runs: [] }); // an empty item still shows its marker
    nested.forEach((n) => walkList(n, marks, level + 1, out));
  });
}

/** Parse a note page's saved HTML into blocks. */
export function htmlToBlocks(html: string): Block[] {
  if (!html || !html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: Block[] = [];
  walkBlocks(doc.body, {}, 0, out);
  // Trailing empty lines are noise, not content.
  while (out.length && out[out.length - 1].spacer) out.pop();
  return out;
}

// ---- plain text -> blocks (todos, boards) -------------------------------

export function plainTextToBlocks(text: string): Block[] {
  const out: Block[] = [];
  let blank = 0;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      blank++;
      continue;
    }
    if (blank > 0 && out.length > 0) out.push({ kind: "para", runs: [], spacer: true });
    blank = 0;
    const heading = line.match(/^---\s*(.+?)\s*---$/);
    if (heading) out.push({ kind: "heading", runs: [{ text: heading[1], bold: true }] });
    else out.push({ kind: "para", runs: [{ text: line }] });
  }
  return out;
}

// ---- entry -> blocks ----------------------------------------------------

export function entryToBlocks(entry: Entry): Block[] {
  const title: Block = { kind: "title", runs: [{ text: entry.title || "Untitled", bold: true }] };

  if (entry.type === "regular") {
    const out: Block[] = [title];
    if (entry.pages.length === 0) {
      out.push(...htmlToBlocks(entry.content));
      return out;
    }
    const pages = [
      { name: entry.page1Name || "Page 1", content: entry.content },
      ...entry.pages.map((p, i) => ({ name: p.name || `Page ${i + 2}`, content: p.content })),
    ];
    for (const p of pages) {
      out.push({ kind: "heading", runs: [{ text: p.name, bold: true }] });
      out.push(...htmlToBlocks(p.content));
    }
    return out;
  }

  // Todos and boards have no rich body: reuse the exact plain-text layout
  // the .txt export already uses so the three formats never disagree
  // about what an entry contains. Its first line is the title.
  const lines = plainTextToBlocks(entryToPlainText(entry));
  if (lines.length && lines[0].kind === "para") lines[0] = title;
  else lines.unshift(title);
  return lines;
}
