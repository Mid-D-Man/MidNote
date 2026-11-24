// Reading view, part 1: a small Markdown parser. Plain TypeScript, no DOM, no dependency: tested in Node.
//
// It turns text into a TREE (Block / Inline below), never into an HTML string. The screen draws the tree with Svelte
// components (components/notes/ReadingView), so nothing the note says can ever become markup: no {@html} anywhere.
//
// WHAT IT UNDERSTANDS (GitHub style, the part people actually type in notes):
//   headings (# .. ######), paragraphs, bold, italic, ~~strike~~, `code`, fenced code blocks (```lang), block quotes,
//   bullet / numbered / task lists (nested), horizontal rules, tables, [links](url), <autolinks>, bare https:// links.
// WHAT IT LEAVES OUT ON PURPOSE: raw HTML (shown as text), images (an image becomes its description: the app is
// offline-first and a note must not fetch things), indented code blocks (indenting is how people lay out notes),
// setext headings (a line of --- under text is a rule), reference links, footnotes.
//
// NOTES ARE LINE-ORIENTED: you press Enter for a new line, so a single line break inside a paragraph is KEPT as a
// line break (like GitHub comments), not folded into one flowing paragraph.
//
// THE EDITOR'S OWN FORMATTING (bold, italic, underline, strike) arrives as private-use marker characters
// (MARKS below, written by utils/noteMarkdown.ts), so it never clashes with a * or _ the person typed.
//
// Everything is bounded: nesting depth, how far an emphasis closer is searched for, link sizes. Odd input gives odd
// output, never a hang and never an exception.

export type Align = "left" | "center" | "right" | null;

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "em" | "strong" | "del" | "ins"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "image"; alt: string }
  | { t: "br" };

export interface ListItem {
  /** true / false for a task item ("- [x] done"), null for a plain item. */
  checked: boolean | null;
  c: Block[];
}

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "para"; c: Inline[] }
  | { t: "code"; lang: string; v: string; /** Show line numbers (a whole note shown as code). */ numbered?: boolean }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "hr" }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  /** A framed part of a document: a slide of a presentation or a page of a PDF (utils/readingDocs.ts). `label` may be empty. */
  | { t: "section"; kind: "slide" | "page"; label: string; c: Block[] }
  /** A picture kept with a note on this phone (utils/docImageStore.ts); `key` says which. */
  | { t: "image"; key: string; alt: string };

export interface ParseOptions {
  /** Turn bare https:// addresses into links. */
  autolink: boolean;
}

/** The private-use characters the note converter writes around the editor's own formatting. */
export const MARKS = {
  ins: ["\uE010", "\uE011"], // underline
  strong: ["\uE020", "\uE021"],
  em: ["\uE022", "\uE023"],
  del: ["\uE024", "\uE025"],
} as const;

const MARK_KINDS = ["ins", "strong", "em", "del"] as const;
const MARK_RE = /[\uE000-\uF8FF]/g; // the whole private-use block: the marks above and anything else that should never be shown

export const MAX_DEPTH = 8;
const MAX_SCAN = 4000;
const MAX_LINK = 2000;
const MAX_COLUMNS = 50;

// ---------------------------------------------------------------------------------------------------- characters

const isWs = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
const isPunct = (c: string | undefined): boolean => c !== undefined && /[\p{P}\p{S}]/u.test(c);
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isAsciiPunct = (c: string | undefined): boolean => c !== undefined && /[!-/:-@[-`{-~]/.test(c);

/** Can a run of `ch` that sits between `prev` and `next` OPEN emphasis? */
function canOpen(ch: string, prev: string | undefined, next: string | undefined): boolean {
  if (isWs(next)) return false;
  if (isPunct(next) && !(isWs(prev) || isPunct(prev))) return false;
  if (ch === "_" && isWord(prev)) return false; // snake_case_names are not emphasis
  return true;
}

/** Can a run of `ch` that sits between `prev` and `next` CLOSE emphasis? */
function canClose(ch: string, prev: string | undefined, next: string | undefined): boolean {
  if (isWs(prev)) return false;
  if (isPunct(prev) && !(isWs(next) || isPunct(next))) return false;
  if (ch === "_" && isWord(next)) return false;
  return true;
}

// ------------------------------------------------------------------------------------------------------- links

/** A web address that is safe to open: http, https or mailto, nothing else (no javascript:, data:, file:, relative paths). */
export function safeHref(raw: string): string | null {
  const u = raw.replace(/[\u0000-\u0020\u007F-\u009F\u200B-\u200F\u2028\u2029\uE000-\uF8FF\uFEFF]/g, "");
  if (u.length > MAX_LINK) return null;
  if (/^https?:\/\/[^/?#]+/i.test(u) && !/^https?:\/\/[^/?#]*[\\<>"]/i.test(u)) return u;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return u;
  return null;
}

const AUTOLINK_RE = /<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>/y;
const BARE_URL_RE = /https?:\/\/[^\s<>\uE000-\uF8FF]+/y;

function trimUrlEnd(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (last !== undefined && ".,;:!?'\"*_~".includes(last)) {
      u = u.slice(0, -1);
    } else if (last === ")" || last === "]" || last === "}") {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
      if (u.split(last).length > u.split(open).length) u = u.slice(0, -1);
      else break;
    } else break;
  }
  return u;
}

// ------------------------------------------------------------------------------------------------------- inline

interface InlineState {
  autolink: boolean;
  noLink: boolean;
}

/** The index just after the code span that starts at `i` (a run of backticks), or -1 when it has no closing run. */
function codeSpanEnd(s: string, i: number): { end: number; run: number } {
  let run = 0;
  while (s[i + run] === "`") run++;
  let j = i + run;
  while (j < s.length) {
    if (s[j] === "`") {
      let r = 0;
      while (s[j + r] === "`") r++;
      if (r === run) return { end: j + r, run };
      j += r;
    } else j++;
  }
  return { end: -1, run };
}

/** Where the matching closer for an opener of `ch` x `level` is, starting the search at `from`; -1 when there is none. */
function findCloser(s: string, from: number, ch: string, level: number, none: Map<string, number>): number {
  const limit = Math.min(s.length, from + MAX_SCAN);
  const key = ch + level;
  const known = none.get(key);
  if (known !== undefined && from >= known) return -1;
  for (let j = from; j < limit; ) {
    const c = s[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      const cs = codeSpanEnd(s, j);
      j = cs.end === -1 ? j + cs.run : cs.end;
      continue;
    }
    if (c === ch) {
      let r = 0;
      while (s[j + r] === ch) r++;
      if (r === level && canClose(ch, s[j - 1], s[j + r])) return j;
      j += r;
      continue;
    }
    j++;
  }
  // the whole rest was searched: no later opener of this kind can find a closer either
  if (limit === s.length) none.set(key, Math.min(known ?? from, from));
  return -1;
}

/** The index of the `]` that closes the `[` at `i`, or -1. */
function bracketEnd(s: string, i: number): number {
  let depth = 0;
  const limit = Math.min(s.length, i + MAX_LINK);
  for (let j = i; j < limit; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Reads "(url "title")" starting at the "(" at `i`. Returns the address and the index after the ")". */
function linkTarget(s: string, i: number): { url: string; end: number } | null {
  let k = i + 1;
  while (s[k] === " ") k++;
  let url = "";
  if (s[k] === "<") {
    const close = s.indexOf(">", k);
    if (close === -1 || close - k > MAX_LINK || s.slice(k, close).includes("\n")) return null;
    url = s.slice(k + 1, close);
    k = close + 1;
  } else {
    let depth = 0;
    const start = k;
    while (k < s.length && k - start < MAX_LINK) {
      const c = s[k];
      if (c === "\\" && isAsciiPunct(s[k + 1])) {
        k += 2;
        continue;
      }
      if (c === " " || c === "\n") break;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      k++;
    }
    url = s.slice(start, k).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  }
  while (s[k] === " ") k++;
  if (s[k] === '"' || s[k] === "'") {
    const q = s[k];
    const close = s.indexOf(q, k + 1);
    if (close === -1 || close - k > MAX_LINK) return null;
    k = close + 1;
    while (s[k] === " ") k++;
  }
  if (s[k] !== ")") return null;
  return { url, end: k + 1 };
}

/** The plain text inside some inlines (an image's description, or the text of a link that is not allowed to open). */
function plainOf(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text" || n.t === "code") out += n.v;
    else if (n.t === "br") out += " ";
    else if (n.t === "image") out += n.alt;
    else out += plainOf(n.c);
  }
  return out;
}

function parseInlineInner(s: string, depth: number, st: InlineState): Inline[] {
  const none = new Map<string, number>(); // (char + level) -> a position of THIS text after which no closer exists
  const noClose = new Set<string>(); // editor marks whose closing character is nowhere after the first try (stops a long run of openers from rescanning)
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // backslash escapes
    if (c === "\\") {
      const n = s[i + 1];
      if (n === "\n") {
        flush();
        out.push({ t: "br" });
        i += 2;
        continue;
      }
      if (isAsciiPunct(n)) {
        buf += n;
        i += 2;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    // line break (notes keep every line break)
    if (c === "\n") {
      buf = buf.replace(/[ \t]+$/, "");
      flush();
      out.push({ t: "br" });
      i++;
      while (s[i] === " " || s[i] === "\t") i++;
      continue;
    }
    // code span
    if (c === "`") {
      const cs = codeSpanEnd(s, i);
      if (cs.end === -1) {
        buf += "`".repeat(cs.run);
        i += cs.run;
        continue;
      }
      let code = s.slice(i + cs.run, cs.end - cs.run).replace(/\n/g, " ");
      if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
      flush();
      out.push({ t: "code", v: code.replace(MARK_RE, "") });
      i = cs.end;
      continue;
    }
    // the editor's own marks
    if (c >= "\uE000" && c <= "\uF8FF") {
      const kind = MARK_KINDS.find((k) => MARKS[k][0] === c);
      if (kind && depth < MAX_DEPTH && !noClose.has(kind)) {
        const close = s.indexOf(MARKS[kind][1], i + 1);
        if (close === -1) noClose.add(kind);
        else {
          flush();
          const inner = parseInlineInner(s.slice(i + 1, close), depth + 1, st);
          if (inner.length > 0) out.push({ t: kind, c: inner });
          i = close + 1;
          continue;
        }
      }
      i++; // an unmatched or closing mark: not shown
      continue;
    }
    // images: shown as their description
    if (c === "!" && s[i + 1] === "[") {
      const end = bracketEnd(s, i + 1);
      if (end !== -1 && s[end + 1] === "(") {
        const target = linkTarget(s, end + 1);
        if (target) {
          flush();
          out.push({ t: "image", alt: plainOf(parseInlineInner(s.slice(i + 2, end), depth + 1, st)).trim() });
          i = target.end;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    // links
    if (c === "[") {
      const end = bracketEnd(s, i);
      if (end !== -1 && s[end + 1] === "(") {
        const target = linkTarget(s, end + 1);
        if (target) {
          const href = st.noLink ? null : safeHref(target.url);
          flush();
          const inner = parseInlineInner(s.slice(i + 1, end), depth + 1, { ...st, noLink: true });
          if (href) out.push({ t: "link", href, c: inner });
          else out.push(...inner);
          i = target.end;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    // <https://...> and <me@site.com>
    if (c === "<") {
      AUTOLINK_RE.lastIndex = i;
      const m = AUTOLINK_RE.exec(s);
      if (m) {
        const raw = m[1].replace(MARK_RE, "");
        const href = st.noLink ? null : safeHref(/^(https?:|mailto:)/i.test(raw) ? raw : "mailto:" + raw);
        flush();
        if (href) out.push({ t: "link", href, c: [{ t: "text", v: raw.replace(/^mailto:/i, "") }] });
        else out.push({ t: "text", v: raw });
        i += m[0].length;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    // bare addresses
    if ((c === "h" || c === "H") && st.autolink && !st.noLink && !isWord(s[i - 1])) {
      BARE_URL_RE.lastIndex = i;
      const m = BARE_URL_RE.exec(s);
      if (m) {
        const url = trimUrlEnd(m[0]);
        const href = safeHref(url);
        if (href) {
          flush();
          out.push({ t: "link", href, c: [{ t: "text", v: url }] });
          i += url.length;
          continue;
        }
      }
    }
    // emphasis and strike
    if ((c === "*" || c === "_" || c === "~") && depth < MAX_DEPTH) {
      let run = 0;
      while (s[i + run] === c) run++;
      const prev = s[i - 1];
      const level = c === "~" ? (run >= 2 ? 2 : 0) : Math.min(run, 3);
      if (level > 0 && canOpen(c, prev, s[i + run])) {
        // use the first `level` characters of the run when it is longer (a * after ** is text)
        const start = i;
        const closer = findCloser(s, start + level, c, level, none);
        if (closer !== -1 && closer > start + level) {
          flush();
          const inner = parseInlineInner(s.slice(start + level, closer), depth + 1, st);
          if (c === "~") out.push({ t: "del", c: inner });
          else if (level === 1) out.push({ t: "em", c: inner });
          else if (level === 2) out.push({ t: "strong", c: inner });
          else out.push({ t: "em", c: [{ t: "strong", c: inner }] });
          i = closer + level;
          continue;
        }
      }
      buf += s.slice(i, i + run);
      i += run;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Inline text -> inline nodes. A "\n" inside is a line break. */
export function parseInline(src: string, opts: ParseOptions = { autolink: true }): Inline[] {
  return parseInlineInner(src, 0, { autolink: opts.autolink, noLink: false });
}

// -------------------------------------------------------------------------------------------------------- blocks

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>/;
const ITEM_RE = /^( {0,3})([-+*]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TASK_RE = /^\[([ xX])\](?:[ \t]+(.*)|[ \t]*)$/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

const isBlank = (line: string): boolean => line.trim() === "";

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function tableAt(lines: string[], i: number): boolean {
  const head = lines[i];
  const delim = lines[i + 1];
  if (delim === undefined || !head.includes("|") || !delim.includes("-") || !TABLE_DELIM_RE.test(delim)) return false;
  const n = splitRow(head).length;
  return n >= 1 && n === splitRow(delim).length && n <= MAX_COLUMNS && (delim.includes("|") || head.trim().startsWith("|") || n > 1);
}

/** Would this line start something other than a paragraph (so that a paragraph above it ends)? */
function interruptsParagraph(lines: string[], i: number): boolean {
  const line = lines[i];
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)) return true;
  const m = ITEM_RE.exec(line);
  if (m) {
    const marker = m[2];
    // a numbered line only interrupts when it starts a list at 1 (so "2020. A year" stays text)
    if (/^\d/.test(marker)) return parseInt(marker, 10) === 1 && m[3] !== undefined;
    return m[3] !== undefined;
  }
  return tableAt(lines, i);
}

function parseBlocksInner(lines: string[], depth: number, opts: ParseOptions): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const inline = (text: string) => parseInline(text, opts);
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    // fenced code
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const info = fence[2].trim();
      const body: string[] = [];
      const open = indentOf(line);
      i++;
      const closeRe = new RegExp("^ {0,3}" + (marker[0] === "`" ? "`" : "~") + "{" + marker.length + ",}[ \\t]*$");
      while (i < lines.length && !closeRe.test(lines[i])) {
        // the fence's own indentation is not part of the code
        let l = lines[i];
        let strip = Math.min(open, indentOf(l));
        while (strip > 0) {
          l = l.slice(1);
          strip--;
        }
        body.push(l);
        i++;
      }
      if (i < lines.length) i++; // the closing fence
      blocks.push({ t: "code", lang: info.split(/\s+/)[0] ?? "", v: body.join("\n") });
      continue;
    }
    // heading
    const h = HEADING_RE.exec(line);
    if (h) {
      blocks.push({ t: "heading", level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6, c: inline((h[2] ?? "").trim()) });
      i++;
      continue;
    }
    // rule
    if (HR_RE.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    // quote
    if (QUOTE_RE.test(line) && depth < MAX_DEPTH) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i++;
      }
      blocks.push({ t: "quote", c: parseBlocksInner(inner, depth + 1, opts) });
      continue;
    }
    // list
    const item = ITEM_RE.exec(line);
    if (item && depth < MAX_DEPTH) {
      const ordered = /^\d/.test(item[2]);
      const start = ordered ? parseInt(item[2], 10) : 1;
      const base = item[1].length;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = ITEM_RE.exec(lines[i]);
        // the next item of THIS list: a marker of the same kind at (about) the same indentation
        if (!m || /^\d/.test(m[2]) !== ordered || m[1].length >= base + 2) break;
        const first = m[3] ?? "";
        const content: string[] = [first];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            // a blank line only continues the item when what follows is indented under it
            let k = i;
            while (k < lines.length && isBlank(lines[k])) k++;
            if (k < lines.length && indentOf(lines[k]) >= base + 2) {
              for (let b = i; b < k; b++) content.push("");
              i = k;
              continue;
            }
            break;
          }
          if (indentOf(l) >= base + 2) {
            content.push(l.slice(Math.min(indentOf(l), base + 2)));
            i++;
            continue;
          }
          break;
        }
        let checked: boolean | null = null;
        const task = TASK_RE.exec(first);
        if (task) {
          checked = task[1] !== " ";
          content[0] = task[2] ?? "";
        }
        items.push({ checked, c: parseBlocksInner(content, depth + 1, opts) });
        // blank lines between items
        let k = i;
        while (k < lines.length && isBlank(lines[k])) k++;
        const nx = k < lines.length ? ITEM_RE.exec(lines[k]) : null;
        if (nx && /^\d/.test(nx[2]) === ordered && nx[1].length < base + 2) i = k;
      }
      blocks.push({ t: "list", ordered, start, items });
      continue;
    }
    // table
    if (tableAt(lines, i)) {
      const head = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((d) => {
        const l = d.startsWith(":");
        const r = d.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : null;
      });
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        const row: Inline[][] = [];
        for (let c = 0; c < head.length; c++) row.push(inline(cells[c] ?? ""));
        rows.push(row);
        i++;
      }
      blocks.push({ t: "table", align, head: head.map((c) => inline(c)), rows });
      continue;
    }
    // paragraph: this line and the ones after it, until something else starts
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines, i)) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "para", c: inline(para.join("\n")) });
  }
  return blocks;
}

/** Markdown text -> blocks. `\r\n` and tabs are tidied first. */
export function parseMarkdown(src: string, opts: ParseOptions = { autolink: true }): Block[] {
  const text = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\u00A0\u202F]/g, " ");
  return parseBlocksInner(text.split("\n"), 0, opts);
}

/** `text` with every character Markdown could read as syntax escaped, so it comes out exactly as typed. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]()#+\-.!|>~<&]/g, "\\$&");
}
