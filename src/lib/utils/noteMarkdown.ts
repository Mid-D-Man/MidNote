// Reading view, part 3: the note's saved HTML -> the text the Markdown parser (utils/markdown.ts) reads.
//
// The editor saves one <div> per line (a blank line is <div><br></div>), lists, checklists, and bold / italic /
// underline / strike. This turns that into plain lines:
//   - every line becomes a line, a blank <div> a blank line;
//   - lists become "- item", "1. item", "- [ ] task" / "- [x] task" (nested lists indented);
//   - bold / italic / underline / strike become the private marker characters (MARKS in markdown.ts), NOT * or _, so
//     they never mix up with a * or _ that was typed;
//   - colours, sizes and fonts are left out (the reading view has its own look).
//
// markdown = true : what was typed is left as typed, so "# Title", "**bold**", tables and ``` fences are read as
//                   Markdown. markdown = false: every character Markdown could read as syntax is escaped, so the text
//                   comes out exactly as typed and only the editor's own formatting shows.
//
// A small tag scanner, not a DOM: it works the same in the app and in Node tests, and the editor's HTML is simple
// and machine-written. Plain TypeScript.
import { MARKS, escapeMarkdown } from "$lib/utils/markdown";
import { cleanPlainText } from "$lib/utils/plainClean";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z]{2,8});/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}

const TOKEN_RE = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;

type MarkKind = keyof typeof MARKS;
const MARK_TAGS: Record<string, MarkKind> = { strong: "strong", b: "strong", em: "em", i: "em", s: "del", strike: "del", del: "del", u: "ins", ins: "ins" };
const BLOCK_TAGS = new Set(["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);

function attr(attrs: string, name: string): string | null {
  const m = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", "i").exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** Spaces inside a mark go outside it, and a mark with nothing in it goes away (so "**x **" cannot happen). */
function tidyMarks(line: string): string {
  let out = line;
  for (const kind of Object.keys(MARKS) as MarkKind[]) {
    const [o, c] = MARKS[kind];
    out = out.replace(new RegExp(o + "([ \\t]+)", "g"), "$1" + o).replace(new RegExp("([ \\t]+)" + c, "g"), c + "$1");
    out = out.replace(new RegExp(o + "(\\s*)" + c, "g"), "$1");
  }
  return out;
}

/** The lines of `text`, where a mark that is open at a line break is closed there and opened again on the next line. */
function splitLines(text: string): string[] {
  const out: string[] = [];
  const open: MarkKind[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") {
      for (let k = open.length - 1; k >= 0; k--) cur += MARKS[open[k]][1];
      out.push(cur);
      cur = open.map((kind) => MARKS[kind][0]).join("");
      continue;
    }
    cur += ch;
    for (const kind of Object.keys(MARKS) as MarkKind[]) {
      if (ch === MARKS[kind][0]) open.push(kind);
      else if (ch === MARKS[kind][1]) {
        const at = open.lastIndexOf(kind);
        if (at !== -1) open.splice(at, 1);
      }
    }
  }
  out.push(cur);
  return out;
}

interface ListCtx {
  ordered: boolean;
  task: boolean;
  n: number;
  base: string;
}

export function noteHtmlToMarkdown(html: string, opts: { markdown: boolean }): string {
  const lines: string[] = [];
  let buf = "";
  const marks: Record<MarkKind, number> = { strong: 0, em: 0, del: 0, ins: 0 };
  const lists: ListCtx[] = [];
  // the list item being written: its first line gets the marker, the others are indented under it
  const items: Array<{ base: string; width: number }> = [];
  let marker: string | null = null;
  let skip = 0; // inside a task item's checkbox <label>
  const blocks: Array<{ hadChild: boolean }> = [];

  const closeMarks = () => {
    for (const kind of Object.keys(marks) as MarkKind[]) {
      if (marks[kind] > 0) buf += MARKS[kind][1];
      marks[kind] = 0;
    }
  };
  const pushLine = (text: string) => {
    const item = items[items.length - 1];
    if (marker !== null && item) {
      lines.push(item.base + marker + text);
      marker = null;
    } else if (item) {
      lines.push(text === "" ? "" : item.base + " ".repeat(item.width) + text);
    } else lines.push(text);
  };
  const hasText = () => /\S/.test(buf.replace(/[\uE000-\uF8FF]/g, ""));
  const flush = () => {
    closeMarks();
    let text = buf;
    buf = "";
    if (text.endsWith("\n")) text = text.slice(0, -1); // the <br> a browser keeps at the end of a line
    for (const part of splitLines(text)) pushLine(tidyMarks(part));
  };
  const blank = () => {
    buf = "";
    closeMarks();
    buf = "";
    pushLine("");
  };

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(html))) {
    const [whole, slash, rawName, attrs, text] = m;
    if (whole.startsWith("<!--")) continue;
    if (rawName === undefined) {
      // text (or a stray "<")
      if (skip > 0) continue;
      const t = text ?? whole;
      if (/^\s*$/.test(t) && /[\r\n]/.test(t)) continue; // the layout whitespace between tags
      let s = cleanPlainText(decodeEntities(t)).replace(/[\uE000-\uF8FF]/g, "").replace(/\r?\n/g, " ");
      if (!opts.markdown) s = escapeMarkdown(s);
      buf += s;
      continue;
    }
    const name = rawName.toLowerCase();
    const closing = slash === "/";
    if (name === "label") {
      skip = Math.max(0, skip + (closing ? -1 : 1));
      continue;
    }
    if (skip > 0 || name === "input") continue;
    const markKind = MARK_TAGS[name];
    if (markKind) {
      if (closing) {
        if (marks[markKind] > 0) {
          marks[markKind]--;
          if (marks[markKind] === 0) buf += MARKS[markKind][1];
        }
      } else {
        if (marks[markKind] === 0) buf += MARKS[markKind][0];
        marks[markKind]++;
      }
      continue;
    }
    if (name === "br") {
      if (!closing) buf += "\n";
      continue;
    }
    if (name === "ul" || name === "ol") {
      if (closing) {
        if (hasText()) flush();
        lists.pop();
      } else {
        if (hasText()) flush();
        if (blocks.length > 0) blocks[blocks.length - 1].hadChild = true;
        const parent = items[items.length - 1];
        const startAttr = name === "ol" ? parseInt(attr(attrs, "start") ?? "1", 10) : 1;
        lists.push({
          ordered: name === "ol",
          task: (attr(attrs, "data-type") ?? "") === "taskList",
          n: Number.isFinite(startAttr) && startAttr >= 0 ? startAttr : 1,
          base: parent ? parent.base + " ".repeat(parent.width) : "",
        });
      }
      continue;
    }
    if (name === "li") {
      if (closing) {
        if (hasText()) flush();
        if (marker !== null && items.length > 0) {
          // an empty item
          const item = items[items.length - 1];
          lines.push(item.base + marker);
          marker = null;
        }
        items.pop();
      } else {
        if (hasText()) flush();
        const list = lists[lists.length - 1];
        const checked = attr(attrs, "data-checked") === "true";
        const isTask = (list?.task ?? false) || (attr(attrs, "data-type") ?? "") === "taskItem";
        let mk: string;
        if (isTask) mk = checked ? "- [x] " : "- [ ] ";
        else if (list?.ordered) mk = `${list.n}. `;
        else mk = "- ";
        if (list?.ordered) list.n++;
        items.push({ base: list?.base ?? "", width: isTask ? 2 : mk.length });
        marker = mk;
      }
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      if (closing) {
        const entry = blocks.pop();
        if (hasText()) flush();
        else if (!entry?.hadChild) blank();
        else {
          buf = "";
          closeMarks();
          buf = "";
        }
      } else {
        if (hasText()) flush();
        if (blocks.length > 0) blocks[blocks.length - 1].hadChild = true;
        blocks.push({ hadChild: false });
        if (name[0] === "h" && name.length === 2) buf = "#".repeat(Number(name[1])) + " ";
      }
      continue;
    }
    // any other tag (span, a, ...): its text is kept, the tag is not
  }
  if (hasText()) flush();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}
