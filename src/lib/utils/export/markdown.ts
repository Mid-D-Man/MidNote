// Round 34 — Markdown writer for "Export as…". Same Block model the .docx and
// .pdf writers read (blocks.ts), so all formats agree about what a note
// contains; this one turns it into CommonMark text.
//
// What survives: the title (# ), page names (## ), bold, italic, strikethrough,
// bullet / numbered / checklist items with nesting, and line breaks.
// What doesn't, because Markdown has no way to say it: colour, highlight, font
// size, underline, roman-numeral numbering (kept as a literal "iv." label), and
// the user's deliberately empty lines (Markdown collapses blank lines anyway).
//
// Text is ESCAPED so a note that happens to contain "*", "_", "#", a leading
// "1." or "- " doesn't turn into formatting it never had.
import type { Block, Run } from "./blocks";

/** Backslash-escape characters that would be read as Markdown inside a line. */
export function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<>~|])/g, "\\$1");
}

/** Escape a block-level marker the line START would otherwise trigger ("# ", "- ", "1. ", "> ", "---", "+ "). */
export function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3")
    .replace(/^(\s*)([-+])(\s|$)/, "$1\\$2$3")
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, "$1$2\\$3$4")
    .replace(/^(\s*)(={2,}|-{3,}|_{3,})\s*$/, "$1\\$2");
}

/** Wrap in a marker, keeping the surrounding spaces OUTSIDE it ("** x **" is not bold). */
function wrap(text: string, marker: string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return text;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

function runToMd(run: Run): string {
  // A hard break inside a run ("\n") becomes a CommonMark backslash line break.
  const parts = run.text.split("\n").map((p) => {
    let t = escapeInline(p);
    if (run.strike) t = wrap(t, "~~");
    if (run.bold && run.italic) t = wrap(t, "***");
    else if (run.bold) t = wrap(t, "**");
    else if (run.italic) t = wrap(t, "*");
    return t;
  });
  return parts.join("\\\n");
}

function inlineMd(runs: Run[]): string {
  return runs.map(runToMd).join("");
}

// blocks.ts marks title and heading runs bold so the Word/PDF writers draw
// them heavy. In Markdown "# " already means that, and "# **Title**" would
// print literal asterisks in some viewers — so headings drop the flag.
function headingMd(runs: Run[]): string {
  return inlineMd(runs.map((r) => ({ ...r, bold: false })));
}

const ORDERED = /^(\d+)\.$/;

function listMarker(prefix: string): { marker: string; labelled: string } {
  if (prefix === "[ ]" || prefix === "[x]") return { marker: `- ${prefix}`, labelled: "" };
  const n = prefix.match(ORDERED);
  if (n) return { marker: `${n[1]}.`, labelled: "" };
  // "•" and "–" are bullets; anything else (roman "iv.") has no Markdown form, so it stays as a label.
  if (prefix === "\u2022" || prefix === "\u2013") return { marker: "-", labelled: "" };
  return { marker: "-", labelled: `${escapeInline(prefix)} ` };
}

/** Indent for nested list levels; 4 spaces so both "-" and "10." children nest under CommonMark. */
const indentOf = (level: number) => "    ".repeat(Math.max(0, level));

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let prevWasList = false;

  const push = (line: string, isList: boolean) => {
    // A blank line separates paragraphs/headings from anything else; list
    // items that follow each other stay tight.
    if (out.length > 0 && !(isList && prevWasList)) out.push("");
    out.push(line);
    prevWasList = isList;
  };

  for (const b of blocks) {
    if (b.spacer) continue; // empty lines collapse in Markdown
    if (b.kind === "title") {
      push(`# ${headingMd(b.runs).trim() || "Untitled"}`, false);
    } else if (b.kind === "heading") {
      push(`## ${headingMd(b.runs).trim()}`, false);
    } else if (b.prefix) {
      const { marker, labelled } = listMarker(b.prefix);
      const text = inlineMd(b.runs).replace(/\\\n/g, `\\\n${indentOf((b.level ?? 0) + 1)}`);
      // Plain, un-prefixed continuation lines never reach here (blocks.ts gives only the first line a prefix).
      push(`${indentOf(b.level ?? 0)}${marker} ${labelled}${text}`.trimEnd(), true);
    } else {
      const text = inlineMd(b.runs).trim();
      if (!text) continue;
      const indented = b.level ? `${indentOf(b.level)}${text}` : text;
      // Only the first line can begin a block marker; later lines of a hard-broken paragraph are inline.
      const [first, ...rest] = indented.split("\\\n");
      push([escapeLineStart(first), ...rest].join("\\\n"), false);
    }
  }
  return out.join("\n") + "\n";
}
