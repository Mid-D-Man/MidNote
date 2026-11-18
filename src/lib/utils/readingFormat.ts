// Reading view, part 4: what a note IS, so the reading page can show it properly. Plain TypeScript, no DOM, no dependency.
//
// A note can hold a story, a Markdown file, a source file opened with "Open with", a JSON export or a CSV sheet. Reading it as
// Markdown garbles code (a * or _ or # in code is not formatting), so the reading page has a "View as" choice:
//   markdown, plain text, JSON (pretty-printed and coloured), table (CSV / TSV), a document (PowerPoint slides, PDF pages, Word
//   paragraphs: utils/readingDocs.ts), or code in one of the languages the highlighter (utils/codeHighlight.ts) knows.
// The first time a note is read the format is guessed: from the file's extension when the note was made by "Open with"
// (formatFromExtension), else from the text itself (detectFormat, deliberately cautious: it only says "code" when the text
// is full of unmistakable code lines, never for ordinary writing). Whatever you pick is remembered for that note.
import { parseMarkdown, type Block, type Inline } from "$lib/utils/markdown";
import { noteHtmlToMarkdown } from "$lib/utils/noteMarkdown";
import { normalizeLang } from "$lib/utils/codeHighlight";
import { docxBlocks, pdfBlocks, pptxBlocks } from "$lib/utils/readingDocs";

export type ReadingFormat = "markdown" | "plain" | "json" | "csv" | "pptx" | "pdf" | "docx" | `code:${string}`;

export interface FormatOption {
  id: ReadingFormat;
  label: string;
  group: "Text" | "Data" | "Documents" | "Code";
}

/** Languages offered under "Code": the highlighter's own names (see normalizeLang) and what to call them. */
export const CODE_LANGS: ReadonlyArray<readonly [string, string]> = [
  ["js", "JavaScript"],
  ["ts", "TypeScript"],
  ["rust", "Rust"],
  ["csharp", "C#"],
  ["python", "Python"],
  ["bash", "Shell"],
  ["sql", "SQL"],
  ["yaml", "YAML"],
  ["toml", "TOML"],
  ["html", "HTML / XML"],
  ["css", "CSS"],
  ["c", "C"],
  ["cpp", "C++"],
  ["java", "Java"],
  ["kotlin", "Kotlin"],
  ["go", "Go"],
  ["diff", "Diff"],
  ["dix", "DixScript"],
];

export const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: "markdown", label: "Markdown", group: "Text" },
  { id: "plain", label: "Plain text", group: "Text" },
  { id: "json", label: "JSON", group: "Data" },
  { id: "csv", label: "Table (CSV)", group: "Data" },
  { id: "pptx", label: "PowerPoint", group: "Documents" },
  { id: "pdf", label: "PDF", group: "Documents" },
  { id: "docx", label: "Word", group: "Documents" },
  ...CODE_LANGS.map(([id, label]): FormatOption => ({ id: `code:${id}`, label, group: "Code" })),
];

export function isFormat(v: unknown): v is ReadingFormat {
  return typeof v === "string" && FORMAT_OPTIONS.some((o) => o.id === v);
}

export function formatLabel(f: ReadingFormat): string {
  return FORMAT_OPTIONS.find((o) => o.id === f)?.label ?? "Markdown";
}

/** The highlighter language of a code format, else null. */
export function codeLangOf(f: ReadingFormat): string | null {
  return f.startsWith("code:") ? f.slice(5) : null;
}

// --------------------------------------------------------------------------------------------------- from the file name

const EXTENSIONS: Record<string, ReadingFormat> = {
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
  txt: "plain", text: "plain", log: "plain",
  json: "json", jsonc: "json", json5: "json", geojson: "json",
  csv: "csv", tsv: "csv",
  pptx: "pptx", ppsx: "pptx",
  pdf: "pdf",
  docx: "docx",
  js: "code:js", mjs: "code:js", cjs: "code:js", jsx: "code:js",
  ts: "code:ts", tsx: "code:ts", mts: "code:ts", cts: "code:ts",
  rs: "code:rust",
  cs: "code:csharp",
  py: "code:python", pyw: "code:python",
  sh: "code:bash", bash: "code:bash", zsh: "code:bash",
  sql: "code:sql",
  yml: "code:yaml", yaml: "code:yaml",
  toml: "code:toml",
  html: "code:html", htm: "code:html", xhtml: "code:html", xml: "code:html", svg: "code:html", svelte: "code:html", vue: "code:html",
  css: "code:css", scss: "code:css", less: "code:css",
  c: "code:c", h: "code:c",
  cpp: "code:cpp", cc: "code:cpp", cxx: "code:cpp", hpp: "code:cpp", hh: "code:cpp",
  java: "code:java",
  kt: "code:kotlin", kts: "code:kotlin",
  go: "code:go",
  diff: "code:diff", patch: "code:diff",
  mdix: "code:dix", dix: "code:dix",
};

/** The format a file name's extension stands for ("main.rs" -> code:rust), or null when it is not one we know. */
export function formatFromExtension(fileName: string | null): ReadingFormat | null {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(fileName ?? "");
  if (!m) return null;
  const key = m[1].toLowerCase();
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, key) ? EXTENSIONS[key] : null;
}

// ---------------------------------------------------------------------------------------------------- from the text

const SIGNALS: Record<string, RegExp[]> = {
  rust: [
    /^\s*(pub(\([a-z]+\))?\s+)?(async\s+)?(unsafe\s+)?fn\s+\w+/,
    /^\s*use\s+[\w:]+(::[\w{},\s*]+)?;\s*$/,
    /^\s*(pub(\([a-z]+\))?\s+)?(struct|enum|trait|impl|mod)\b[\s\w<>:,']*(\{|;)?\s*$/,
    /^\s*let\s+(mut\s+)?\w+(\s*:\s*[^=]+)?\s*=\s*.+;\s*$/,
    /\b(println|print|eprintln|vec|format|panic|assert|assert_eq|todo|unreachable)!\s*[([]/,
    /^\s*#!?\[[a-z_]+/,
    /->\s*[\w<>&:']+\s*\{\s*$/,
  ],
  python: [
    /^\s*def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*$/,
    /^\s*class\s+\w+(\(.*\))?:\s*$/,
    /^\s*import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*\s*$/,
    /^\s*from\s+[\w.]+\s+import\s+([\w*]+(\s+as\s+\w+)?(\s*,\s*[\w*]+)*|\(.*\))\s*$/,
    /^\s*(elif\s+.+|else|try|except[^:]*|finally|with\s+.+|for\s+.+\s+in\s+.+|while\s+.+|if\s+.+):\s*$/,
    /^\s*if\s+__name__\s*==/,
    /^\s*print\(.*\)\s*$/,
  ],
  js: [
    /^\s*(import\s+.+\s+from\s+['"].+['"]|import\s+['"].+['"])\s*;?\s*$/,
    /^\s*export\s+(default\s+)?(const|let|function|class|async|interface|type|enum)\b/,
    /^\s*(const|let|var)\s+[\w{},\s[\]]+\s*(:\s*[^=]+)?=\s*.+/,
    /^\s*(async\s+)?function\s*\*?\s*\w*\s*\(/,
    /=>\s*[{(]?\s*$/,
    /^\s*(console\.\w+|document\.\w+|require)\(/,
    /^\s*}\s*else\s*(if\b.*)?\{?\s*$/,
  ],
  csharp: [
    /^\s*using\s+[\w.]+;\s*$/,
    /^\s*namespace\s+[\w.]+/,
    /^\s*(public|private|protected|internal)\s+(static\s+)?(async\s+)?(sealed\s+|abstract\s+|partial\s+|override\s+|readonly\s+)*[\w<>[\]?,. ]+\s+\w+\s*(\(|\{|;|=)/,
    /^\s*(var|int|string|bool|double|float)\s+\w+\s*=/,
    /\bConsole\.(Write|Read)/,
    /^\s*\[\w+(\(.*\))?\]\s*$/,
  ],
  java: [
    /^\s*package\s+[\w.]+;/,
    /^\s*import\s+(static\s+)?[\w.*]+;\s*$/,
    /^\s*public\s+(static\s+)?(final\s+)?(class|interface|enum|void|[\w<>[\]]+)\s+\w+/,
    /System\.out\.print/,
    /^\s*@(Override|Test|Autowired)\b/,
  ],
  c: [
    /^\s*#\s*(include\s*[<"]|define\s+\w+|ifn?def\s+\w+|pragma\s+\w+)/,
    /^\s*(int|void|char|float|double|static|unsigned|const)\s+[\w*]+\s*\(.*\)\s*\{?\s*$/,
    /\b(printf|scanf|malloc|free)\s*\(/,
  ],
  cpp: [/\bstd::\w+/, /\b(cout\s*<<|cin\s*>>)/, /^\s*using\s+namespace\s+std/, /^\s*template\s*</, /^\s*#\s*include\s*<(iostream|vector|string|map|memory)>/],
  go: [
    /^\s*package\s+\w+\s*$/,
    /^\s*func\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/,
    /^\s*import\s+(\(|")/,
    /\w+\s*:=\s*/,
    /^\s*type\s+\w+\s+(struct|interface)\b/,
  ],
  kotlin: [/^\s*fun\s+\w+\s*\(/, /^\s*(val|var)\s+\w+(\s*:\s*[\w<>?]+)?\s*=/, /^\s*(data\s+)?class\s+\w+\(/, /^\s*(override\s+)?fun\s+\w+/],
  sql: [
    /^\s*select\s+(distinct\s+)?(\*|[\w."`]+(\([^)]*\))?(\s+as\s+\w+)?(\s*,\s*[\w."`]+(\([^)]*\))?(\s+as\s+\w+)?)*)\s+from\s+[\w"`]+(\.[\w"`]+)?(\s|;|$)/i,
    /^\s*SELECT\s+(\*|[\w."`]+\s*,)/,
    /^\s*insert\s+into\s+[\w."`]+\s*(\(|values\b|select\b)/i,
    /^\s*update\s+[\w."`]+\s+set\s+\w+\s*=/i,
    /^\s*delete\s+from\s+[\w."`]+(\s+where\b|\s*;|\s*$)/i,
    /^\s*create\s+(or\s+replace\s+)?(unique\s+)?(table|view|function|index)\s+[\w."`]+/i,
    /^\s*alter\s+table\s+[\w."`]+\s+(add|drop|alter|rename)\b/i,
    /^\s*drop\s+(table|view|index)\s+(if\s+exists\s+)?[\w."`]+/i,
    /^\s*(left|right|inner|full)\s+join\s+[\w."`]+.*\bon\b.+=/i,
    /^\s*group\s+by\s+[\w.]+(\s*,\s*[\w.]+)*;?\s*$/i,
    /^\s*order\s+by\s+[\w.]+(\s+(asc|desc))?(\s*,\s*[\w.]+(\s+(asc|desc))?)*;?\s*$/i,
    /^\s*where\s+[\w.]+\s*(=|<|>|<=|>=|<>|!=|\blike\b|\bin\b|\bis\b)\s*\S+/i,
    /^\s*values\s*\(/i,
  ],
  bash: [
    /^\s*(if\s+\[\[?.*\]\]?;?\s*then|fi|done|esac)\s*$/,
    /^\s*export\s+[A-Za-z_]\w*=\S*/,
    /^\s*(echo|printf)\s+("[^"]*"|'[^']*'|\$\w+|-[a-z]\b)/,
    /^\s*(sudo|apt(-get)?|git|npm|cargo|curl|chmod|mkdir|cd|ls|grep)\s+(-{1,2}\w[\w-]*|(install|add|commit|push|pull|clone|run|build|status|checkout)\b|[\w.~-]*\/[\w./~-]*)/,
    /^\s*(for|while)\s+\w+\s+in\s+.*;\s*do\s*$/,
    /^\s*[A-Za-z_]\w*=\S*\s*$/,
  ],
};
// when two languages score the same, the one earlier in this list wins (the more specific first)
const SNIFF_ORDER = ["rust", "csharp", "java", "kotlin", "go", "cpp", "c", "python", "js", "sql", "bash"] as const;
const TS_ONLY = [/^\s*(interface|type)\s+\w+(<.*>)?\s*(=|\{)/, /:\s*(string|number|boolean|any|unknown|void)\b/];
const MIN_SIGNAL_LINES = 3;
const MAX_SNIFF_CHARS = 2_000_000;
const MAX_SNIFF_LINES = 400;

/** The format the text itself says it is, or null when it looks like ordinary writing (or is not sure). */
export function detectFormat(text: string): ReadingFormat | null {
  const t = text.length > MAX_SNIFF_CHARS ? text.slice(0, MAX_SNIFF_CHARS) : text;
  const trimmed = t.trim();
  if (trimmed === "") return null;
  // text read out of a presentation / PDF by "Open with" (utils/pptxText.ts, pdfText.ts): "Slide 1" / "Page 1" on a line of its own
  // first, and for a PDF a "Page 2" later (a single page has no marker, so only the file's extension can say it was a PDF)
  if (/^Slide 1[ \t]*\n/.test(trimmed)) return "pptx";
  if (/^Page 1[ \t]*\n/.test(trimmed) && /\nPage 2[ \t]*(\n|$)/.test(trimmed)) return "pdf";
  if (/^(```|~~~)/m.test(trimmed)) return null; // a Markdown document with fenced code in it
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "{" && last === "}") || (first === "[" && last === "]")) {
    try {
      JSON.parse(trimmed); // an object or array (the text starts and ends with { } or [ ])
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (/^(<!doctype html|<html[\s>]|<\?xml|<svg[\s>])/i.test(trimmed)) return "code:html";
  const shebang = /^#!.*/.exec(trimmed)?.[0] ?? "";
  if (shebang) {
    if (/\b(ba|z)?sh\b/.test(shebang)) return "code:bash";
    if (/python/.test(shebang)) return "code:python";
    if (/\bnode\b/.test(shebang)) return "code:js";
  }
  if (/^\s*@(CONFIG|DATA|QUICKFUNCS|ENUMS|SETTINGS)\s*\(/m.test(trimmed)) return "code:dix";
  if (/^diff --git /m.test(trimmed) || (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(trimmed) && /^[+-]\s*\S/m.test(trimmed))) return "code:diff";
  const lines = trimmed
    .split("\n")
    .filter((l) => l.trim() !== "")
    .slice(0, MAX_SNIFF_LINES);
  const score: Record<string, number> = {};
  for (const lang of Object.keys(SIGNALS)) score[lang] = lines.filter((l) => SIGNALS[lang].some((re) => re.test(l))).length;
  let best: string | null = null;
  for (const lang of SNIFF_ORDER) {
    if (score[lang] >= MIN_SIGNAL_LINES && (best === null || score[lang] > score[best])) best = lang;
  }
  if (best === null) return null;
  if (best === "c" && score.cpp > 0) best = "cpp";
  if (best === "js" && lines.some((l) => TS_ONLY.some((re) => re.test(l)))) return "code:ts";
  return `code:${best}`;
}

// ------------------------------------------------------------------------------------------------------------ CSV

export const MAX_CSV_ROWS = 1000;
const MAX_CSV_COLUMNS = 100;
const DELIMITERS = [",", "\t", ";", "|"] as const;

/** Splits CSV / TSV text (quotes, doubled quotes, line breaks inside quotes, CRLF, a leading BOM). The delimiter is the one that
 *  appears most on the first line outside quotes. Stops after `maxRows` rows and says so. */
export function parseCsv(text: string, maxRows: number = MAX_CSV_ROWS): { rows: string[][]; truncated: boolean; total: number } {
  const src = text.replace(/^\uFEFF/, "");
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0, "|": 0 };
  let inQ = false;
  for (let i = 0; i < src.length && src[i] !== "\n"; i++) {
    const c = src[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c in counts) counts[c]++;
  }
  let delim = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    if (counts[d] > bestCount) {
      delim = d;
      bestCount = counts[d];
    }
  }
  const rows: string[][] = [];
  let total = 0;
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let any = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === "" && !any)) {
      total++;
      if (rows.length < maxRows) rows.push(row.slice(0, MAX_CSV_COLUMNS));
    }
    row = [];
    any = false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
      any = true;
    } else if (c === delim) {
      endCell();
      any = true;
    } else if (c === "\n" || c === "\r") {
      endRow();
    } else {
      cell += c;
      any = true;
    }
  }
  if (cell !== "" || row.length > 0 || any) endRow();
  return { rows, truncated: total > rows.length, total };
}

// -------------------------------------------------------------------------------------------------- blocks per format

/** The note's text as it was typed (lines, spacing), without any of the editor's formatting marks. */
export function rawNoteText(html: string): string {
  return noteHtmlToMarkdown(html, { markdown: true }).replace(/[\uE000-\uF8FF]/g, "");
}

const MAX_PRETTY_JSON_CHARS = 1_500_000;

const text = (v: string): Inline[] => [{ t: "text", v }];

/** What the reading page draws for a note's saved HTML in the chosen format. */
export function blocksForFormat(html: string, format: ReadingFormat): Block[] {
  if (format === "markdown") return parseMarkdown(noteHtmlToMarkdown(html, { markdown: true }), { autolink: true });
  if (format === "plain") return parseMarkdown(noteHtmlToMarkdown(html, { markdown: false }), { autolink: false });
  const raw = rawNoteText(html);
  if (raw.trim() === "") return [];
  if (format === "json") {
    let shown = raw;
    if (raw.length <= MAX_PRETTY_JSON_CHARS) {
      try {
        shown = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* not valid JSON: shown as it is, still coloured */
      }
    }
    return [{ t: "code", lang: "json", v: shown, numbered: true }];
  }
  if (format === "csv") {
    const { rows, truncated, total } = parseCsv(raw);
    if (rows.length === 0) return [];
    const width = Math.min(MAX_CSV_COLUMNS, Math.max(...rows.map((r) => r.length)));
    const pad = (r: string[]): Inline[][] => Array.from({ length: width }, (_, i) => text(r[i] ?? ""));
    const out: Block[] = [{ t: "table", align: Array.from({ length: width }, () => null), head: pad(rows[0]), rows: rows.slice(1).map(pad) }];
    if (truncated) out.push({ t: "para", c: text(`Showing the first ${rows.length} of ${total} rows.`) });
    return out;
  }
  if (format === "pptx") return pptxBlocks(raw);
  if (format === "pdf") return pdfBlocks(raw);
  if (format === "docx") return docxBlocks(raw);
  const lang = codeLangOf(format);
  return [{ t: "code", lang: lang !== null && normalizeLang(lang) === lang ? lang : "", v: raw, numbered: true }];
}
