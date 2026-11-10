// Reading view, part 2: syntax highlighting for fenced code blocks. Plain TypeScript, no DOM, no dependency.
//
// highlight(code, lang) gives a list of tokens { k: kind, v: text }. The text of the tokens, joined, is EXACTLY the
// code that went in (nothing is dropped, added or changed), so the screen can draw the tokens as <span class="tok-kind">
// without ever touching the characters. The screen draws text, not HTML, so the code can say anything.
//
// It is a small hand-written scanner, not a full parser: comments, strings, numbers, keywords, types, function calls,
// attributes and so on, which is what makes code readable. Languages it knows are listed in LANGUAGES below; a language
// it does not know (or code that is very long) gets null and is shown as plain text.

export type TokenKind = "plain" | "kw" | "type" | "fn" | "str" | "num" | "com" | "const" | "prop" | "attr" | "var" | "tag" | "add" | "del" | "hunk";
export interface Token {
  k: TokenKind;
  v: string;
}

/** Code longer than this is shown without colours (a long paste must not freeze a phone). */
export const MAX_HIGHLIGHT_CHARS = 60000;

class Out {
  tokens: Token[] = [];
  push(k: TokenKind, v: string): void {
    if (v === "") return;
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.k === k) last.v += v;
    else this.tokens.push({ k, v });
  }
}

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

interface Lang {
  line?: string[];
  block?: Array<[string, string]>;
  /** Characters that open a string with backslash escapes. */
  quotes?: string;
  /** Quote characters whose strings may run over several lines. */
  multi?: string;
  /** Quote characters closed by doubling ('' in SQL) instead of a backslash. */
  doubling?: string;
  triple?: string[];
  /** Kind of a double-quoted string when it is not a plain string (SQL quoted names). */
  dqKind?: TokenKind;
  kw: Set<string>;
  types?: Set<string>;
  consts?: Set<string>;
  ci?: boolean;
  /** @name: decorators / annotations (attr) or directives (kw). */
  at?: "attr" | "kw";
  dollar?: boolean;
  macro?: boolean;
  lifetime?: boolean;
  rustAttr?: boolean;
  preproc?: boolean;
  flags?: boolean;
  /** Capitalised names are types, SHOUTING names are constants. */
  caps?: boolean;
  /** Names / strings followed by this are keys (properties). */
  keyed?: RegExp;
  /** Characters allowed inside a name besides letters and digits. */
  nameExtra?: string;
  csharpStrings?: boolean;
  pyPrefix?: boolean;
  rustRaw?: boolean;
  /** A # comment only counts at the start of a line or after a space (shell: ${#x} and $# are not comments). */
  hashNeedsSpace?: boolean;
}

const JS_KW =
  "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set from as type interface enum implements private public protected readonly abstract declare namespace module keyof is satisfies override";
const JS: Lang = {
  line: ["//"],
  block: [["/*", "*/"]],
  quotes: "\"'`",
  multi: "`",
  kw: words(JS_KW),
  types: words("string number boolean any unknown never object symbol bigint void"),
  consts: words("true false null undefined NaN Infinity"),
  at: "attr",
  caps: true,
};
const C_KW =
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename using public private protected virtual override new delete this try catch throw operator friend explicit constexpr noexcept static_assert decltype final bool";

const LANGUAGES: Record<string, Lang> = {
  js: JS,
  ts: JS,
  rust: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: '"',
    multi: '"',
    kw: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while union"),
    types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Self"),
    consts: words("true false None Some Ok Err"),
    macro: true,
    lifetime: true,
    rustAttr: true,
    rustRaw: true,
    caps: true,
  },
  csharp: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: "\"'",
    kw: words(
      "abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await record init get set yield partial where when with required",
    ),
    consts: words("true false null"),
    csharpStrings: true,
    caps: true,
  },
  python: {
    line: ["#"],
    quotes: "\"'",
    triple: ['"""', "'''"],
    kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
    consts: words("True False None"),
    at: "attr",
    pyPrefix: true,
    caps: true,
  },
  json: { quotes: '"', kw: words(""), consts: words("true false null"), keyed: /^[ \t]*:/ },
  bash: {
    line: ["#"],
    quotes: "\"'",
    multi: "\"'",
    kw: words("if then else elif fi for while until do done case esac function in select time return exit break continue export local readonly declare unset source alias set"),
    consts: words("true false"),
    dollar: true,
    flags: true,
    hashNeedsSpace: true,
  },
  sql: {
    line: ["--"],
    block: [["/*", "*/"]],
    quotes: "'\"",
    multi: "'",
    doubling: "'",
    dqKind: "var",
    ci: true,
    kw: words(
      "select from where and or not insert into values update set delete create table alter drop index primary key foreign references join inner left right outer full cross on group by order having limit offset as distinct union all is in like between exists case when then else end asc desc with begin commit rollback default unique check constraint view trigger returning add column if cascade using over partition",
    ),
    types: words("int integer bigint smallint text varchar char boolean bool date time timestamp timestamptz numeric decimal float real serial uuid json jsonb"),
    consts: words("true false null"),
  },
  yaml: {
    line: ["#"],
    quotes: "\"'",
    kw: words(""),
    consts: words("true false null yes no on off True False Null ~"),
    keyed: /^[ \t]*:(?:\s|$)/,
    nameExtra: ".-",
    hashNeedsSpace: true,
  },
  toml: {
    line: ["#"],
    quotes: "\"'",
    triple: ['"""', "'''"],
    kw: words(""),
    consts: words("true false"),
    keyed: /^[ \t]*=/,
    nameExtra: ".-",
  },
  c: { line: ["//"], block: [["/*", "*/"]], quotes: "\"'", kw: words(C_KW), types: words("size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t FILE"), consts: words("true false NULL nullptr"), preproc: true, caps: true },
  java: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: "\"'",
    kw: words(
      "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield",
    ),
    consts: words("true false null"),
    at: "attr",
    caps: true,
  },
  kotlin: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: "\"'",
    multi: '"',
    kw: words(
      "as break class continue do else for fun if in interface is object package return super this throw try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam value where abstract actual annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg",
    ),
    consts: words("true false null"),
    at: "attr",
    caps: true,
  },
  go: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: "\"'`",
    multi: "`",
    kw: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
    types: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any"),
    consts: words("true false nil iota"),
    caps: true,
  },
  dix: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: '"',
    kw: words(""),
    consts: words("true false null"),
    at: "kw",
    keyed: /^[ \t]*(?:->|=|::)/,
  },
};
LANGUAGES.ts = { ...JS, types: words("string number boolean any unknown never object symbol bigint void unknown") };
LANGUAGES.cpp = LANGUAGES.c;

const ALIASES: Record<string, string> = {
  js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js", node: "js",
  ts: "ts", typescript: "ts", tsx: "ts",
  json: "json", jsonc: "json", json5: "json",
  html: "html", htm: "html", xml: "html", svg: "html", svelte: "html", vue: "html", xhtml: "html",
  css: "css", scss: "css", less: "css",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash", console: "bash",
  rust: "rust", rs: "rust",
  cs: "csharp", csharp: "csharp", "c#": "csharp",
  py: "python", python: "python", python3: "python",
  sql: "sql", pgsql: "sql", postgres: "sql", mysql: "sql", sqlite: "sql",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  c: "c", h: "c", cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  java: "java",
  kt: "kotlin", kotlin: "kotlin",
  go: "go", golang: "go",
  diff: "diff", patch: "diff",
  mdix: "dix", dixscript: "dix", dix: "dix",
};

/** The name the highlighter knows a code block's language by ("TSX {1,3}" -> "ts"), or null when it does not know it. */
export function normalizeLang(info: string): string | null {
  const first = (info.trim().toLowerCase().split(/[\s,{]/)[0] ?? "").replace(/^\./, "");
  if (!first || !Object.prototype.hasOwnProperty.call(ALIASES, first)) return null;
  return ALIASES[first];
}

const NAME_START = /[A-Za-z_$\u00C0-\uFFFF]/;
const NUMBER_RE = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[A-Za-z0-9]*/y;

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/** The end of a string that starts at `i` (a quote), as an index just after it. Stops at a line end unless `multi`. */
function stringEnd(code: string, i: number, escapes: boolean, doubling: boolean, multi: boolean): number {
  const q = code[i];
  let j = i + 1;
  while (j < code.length) {
    const c = code[j];
    if (c === "\n" && !multi) return j;
    if (escapes && c === "\\") {
      j += 2;
      continue;
    }
    if (c === q) {
      if (doubling && code[j + 1] === q) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return code.length;
}

function lineEnd(code: string, i: number): number {
  const j = code.indexOf("\n", i);
  return j === -1 ? code.length : j;
}

function scanGeneric(code: string, L: Lang): Token[] {
  const out = new Out();
  const n = code.length;
  const extra = L.nameExtra ?? "";
  const nameRe = new RegExp("[A-Za-z_$\\u00C0-\\uFFFF][\\w$\\u00C0-\\uFFFF" + extra.replace(/[\\\]^-]/g, "\\$&") + "]*", "y");
  let i = 0;
  let lineStart = true; // only spaces since the start of this line
  while (i < n) {
    const c = code[i];
    if (isSpace(c)) {
      let j = i;
      while (j < n && isSpace(code[j])) {
        if (code[j] === "\n") lineStart = true;
        j++;
      }
      out.push("plain", code.slice(i, j));
      i = j;
      continue;
    }
    const startOfLine = lineStart;
    lineStart = false;
    // comments
    let handled = false;
    for (const lc of L.line ?? []) {
      if (code.startsWith(lc, i) && (!L.hashNeedsSpace || lc !== "#" || i === 0 || isSpace(code[i - 1]))) {
        const e = lineEnd(code, i);
        out.push("com", code.slice(i, e));
        i = e;
        handled = true;
        break;
      }
    }
    if (handled) continue;
    for (const [open, close] of L.block ?? []) {
      if (code.startsWith(open, i)) {
        const e = code.indexOf(close, i + open.length);
        const end = e === -1 ? n : e + close.length;
        out.push("com", code.slice(i, end));
        i = end;
        handled = true;
        break;
      }
    }
    if (handled) continue;
    // C preprocessor lines
    if (L.preproc && c === "#" && startOfLine) {
      const e = lineEnd(code, i);
      out.push("attr", code.slice(i, e));
      i = e;
      continue;
    }
    // Rust attributes #[...] #![...]
    if (L.rustAttr && c === "#" && (code[i + 1] === "[" || (code[i + 1] === "!" && code[i + 2] === "["))) {
      let depth = 0;
      let j = i;
      while (j < n && j - i < 500) {
        if (code[j] === "[") depth++;
        else if (code[j] === "]") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        j++;
      }
      out.push("attr", code.slice(i, j));
      i = j;
      continue;
    }
    // triple-quoted strings
    const tq = (L.triple ?? []).find((t) => code.startsWith(t, i));
    if (tq) {
      const e = code.indexOf(tq, i + 3);
      const end = e === -1 ? n : e + 3;
      out.push("str", code.slice(i, end));
      i = end;
      continue;
    }
    // C# @"..." $"..." strings
    if (L.csharpStrings && (c === "@" || c === "$")) {
      let j = i;
      while ((code[j] === "@" || code[j] === "$") && j - i < 3) j++;
      if (code[j] === '"' && j - i <= 2) {
        const verbatim = code.slice(i, j).includes("@");
        const end = stringEnd(code, j, !verbatim, verbatim, verbatim);
        out.push("str", code.slice(i, end));
        i = end;
        continue;
      }
    }
    // Rust lifetimes and chars
    if (L.lifetime && c === "'") {
      if (code[i + 1] === "\\") {
        const e = code.indexOf("'", i + 2);
        const end = e === -1 || e - i > 12 ? i + 1 : e + 1;
        out.push(end === i + 1 ? "plain" : "str", code.slice(i, end));
        i = end;
      } else if (code[i + 2] === "'") {
        out.push("str", code.slice(i, i + 3));
        i += 3;
      } else {
        NAME_RE_STICKY.lastIndex = i + 1;
        const m = NAME_RE_STICKY.exec(code);
        if (m) {
          out.push("attr", code.slice(i, i + 1 + m[0].length));
          i += 1 + m[0].length;
        } else {
          out.push("plain", c);
          i++;
        }
      }
      continue;
    }
    // strings
    if (L.quotes && L.quotes.includes(c) && !(L.lifetime && c === "'")) {
      const doubling = !!L.doubling && L.doubling.includes(c);
      const escapes = !doubling && !(L.dollar && c === "'");
      const end = stringEnd(code, i, escapes, doubling, !!L.multi && L.multi.includes(c));
      let kind: TokenKind = c === '"' && L.dqKind ? L.dqKind : "str";
      if (L.keyed && L.keyed.test(code.slice(end, end + 12))) kind = "prop";
      out.push(kind, code.slice(i, end));
      i = end;
      continue;
    }
    // numbers
    if (c >= "0" && c <= "9") {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(code);
      if (m) {
        out.push("num", m[0]);
        i += m[0].length;
        continue;
      }
    }
    // $variables
    if (L.dollar && c === "$") {
      DOLLAR_RE.lastIndex = i;
      const m = DOLLAR_RE.exec(code);
      if (m) {
        out.push("var", m[0]);
        i += m[0].length;
        continue;
      }
    }
    // @decorators / directives
    if (L.at && c === "@") {
      AT_RE.lastIndex = i;
      const m = AT_RE.exec(code);
      if (m) {
        out.push(L.at, m[0]);
        i += m[0].length;
        continue;
      }
    }
    // --flags
    if (L.flags && c === "-" && (i === 0 || isSpace(code[i - 1]))) {
      FLAG_RE.lastIndex = i;
      const m = FLAG_RE.exec(code);
      if (m) {
        out.push("attr", m[0]);
        i += m[0].length;
        continue;
      }
    }
    // names
    if (NAME_START.test(c)) {
      nameRe.lastIndex = i;
      const m = nameRe.exec(code);
      if (m) {
        let word = m[0];
        let end = i + word.length;
        // string prefixes: Python r"..", Rust r#".."#
        if (L.pyPrefix && /^[rRbBfFuU]{1,2}$/.test(word) && (code[end] === '"' || code[end] === "'")) {
          const t3 = (L.triple ?? []).find((t) => code.startsWith(t, end));
          let e2: number;
          if (t3) {
            const close = code.indexOf(t3, end + 3);
            e2 = close === -1 ? n : close + 3;
          } else e2 = stringEnd(code, end, !/[rR]/.test(word), false, false);
          out.push("str", code.slice(i, e2));
          i = e2;
          continue;
        }
        if (L.rustRaw && /^b?r$/.test(word) && (code[end] === '"' || code[end] === "#")) {
          let h = end;
          while (code[h] === "#") h++;
          if (code[h] === '"') {
            const hashes = code.slice(end, h);
            const e = code.indexOf('"' + hashes, h + 1);
            const stop = e === -1 ? n : e + 1 + hashes.length;
            out.push("str", code.slice(i, stop));
            i = stop;
            continue;
          }
        }
        const key = L.ci ? word.toLowerCase() : word;
        let kind: TokenKind = "plain";
        const rest = code.slice(end, end + 16);
        if (L.keyed && L.keyed.test(rest)) kind = "prop";
        else if (L.kw.has(key)) kind = "kw";
        else if (L.consts?.has(word) || L.consts?.has(key)) kind = "const";
        else if (L.types?.has(key)) kind = "type";
        else if (L.macro && code[end] === "!" && /[([{]/.test(code[end + 1] ?? "")) {
          word += "!";
          end++;
          kind = "fn";
        } else if (/^[ \t]*\(/.test(rest)) kind = "fn";
        else if (L.caps && /^[A-Z][A-Z0-9_]+$/.test(word)) kind = "const";
        else if (L.caps && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(word)) kind = "type";
        out.push(kind, word);
        i = end;
        continue;
      }
    }
    // anything else: one character of plain text
    out.push("plain", c);
    i++;
  }
  return out.tokens;
}

const NAME_RE_STICKY = /[A-Za-z_][A-Za-z0-9_]*/y;
const DOLLAR_RE = /\$(?:\{[^}\n]*\}|[A-Za-z_][A-Za-z0-9_]*|[#?@*!$0-9-])/y;
const AT_RE = /@[A-Za-z_][\w.]*/y;
const FLAG_RE = /--?[A-Za-z][\w-]*/y;

// ------------------------------------------------------------------------------------------------------- HTML / XML

function scanHtml(code: string): Token[] {
  const out = new Out();
  const n = code.length;
  let i = 0;
  while (i < n) {
    if (code.startsWith("<!--", i)) {
      const e = code.indexOf("-->", i + 4);
      const end = e === -1 ? n : e + 3;
      out.push("com", code.slice(i, end));
      i = end;
      continue;
    }
    if (code.startsWith("<!", i) || code.startsWith("<?", i)) {
      const e = code.indexOf(">", i);
      const end = e === -1 ? n : e + 1;
      out.push("attr", code.slice(i, end));
      i = end;
      continue;
    }
    if (code[i] === "<" && /[A-Za-z/]/.test(code[i + 1] ?? "")) {
      let j = i + 1;
      if (code[j] === "/") j++;
      while (j < n && /[^\s/>]/.test(code[j])) j++;
      out.push("tag", code.slice(i, j));
      // attributes until the tag closes
      while (j < n && code[j] !== ">") {
        const c = code[j];
        if (isSpace(c)) {
          let k = j;
          while (k < n && isSpace(code[k])) k++;
          out.push("plain", code.slice(j, k));
          j = k;
        } else if (c === "/" && code[j + 1] === ">") {
          out.push("tag", "/");
          j++;
        } else if (c === '"' || c === "'") {
          const e = code.indexOf(c, j + 1);
          const end = e === -1 ? n : e + 1;
          out.push("str", code.slice(j, end));
          j = end;
        } else if (c === "=") {
          out.push("plain", "=");
          j++;
        } else {
          let k = j;
          while (k < n && /[^\s=/>"']/.test(code[k])) k++;
          if (k === j) k = j + 1;
          out.push("attr", code.slice(j, k));
          j = k;
        }
      }
      if (j < n) {
        out.push("tag", ">");
        j++;
      }
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < n && code[j] !== "<") j++;
    out.push("plain", code.slice(i, j));
    i = j;
  }
  return out.tokens;
}

// -------------------------------------------------------------------------------------------------------------- CSS

function scanCss(code: string): Token[] {
  const out = new Out();
  const n = code.length;
  let i = 0;
  let depth = 0;
  let paren = 0;
  while (i < n) {
    const c = code[i];
    if (isSpace(c)) {
      let j = i;
      while (j < n && isSpace(code[j])) j++;
      out.push("plain", code.slice(i, j));
      i = j;
      continue;
    }
    if (code.startsWith("/*", i)) {
      const e = code.indexOf("*/", i + 2);
      const end = e === -1 ? n : e + 2;
      out.push("com", code.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(code, i, true, false, false);
      out.push("str", code.slice(i, end));
      i = end;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    if (c === "{" || c === "}" || c === "(" || c === ")") {
      out.push("plain", c);
      i++;
      continue;
    }
    if (c === "@") {
      CSS_AT_RE.lastIndex = i;
      const m = CSS_AT_RE.exec(code);
      if (m) {
        out.push("kw", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (c === "#" && depth > 0) {
      CSS_HEX_RE.lastIndex = i;
      const m = CSS_HEX_RE.exec(code);
      if (m) {
        out.push("num", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (c === "!" && /^!\s*important/i.test(code.slice(i, i + 16))) {
      const m = /^!\s*important/i.exec(code.slice(i, i + 16)) as RegExpExecArray;
      out.push("kw", m[0]);
      i += m[0].length;
      continue;
    }
    if ((c >= "0" && c <= "9") || ((c === "." || c === "-") && /\d/.test(code[i + 1] ?? "") && depth > 0)) {
      CSS_NUM_RE.lastIndex = i;
      const m = CSS_NUM_RE.exec(code);
      if (m) {
        out.push("num", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (c === "-" && code[i + 1] === "-" && depth > 0) {
      CSS_NAME_RE.lastIndex = i;
      const m = CSS_NAME_RE.exec(code);
      if (m) {
        out.push("var", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (depth === 0 && paren === 0 && (c === "." || c === "#" || c === ":" || /[A-Za-z_-]/.test(c))) {
      CSS_SEL_RE.lastIndex = i;
      const m = CSS_SEL_RE.exec(code);
      if (m) {
        out.push("type", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_-]/.test(c)) {
      CSS_NAME_RE.lastIndex = i;
      const m = CSS_NAME_RE.exec(code);
      if (m) {
        const rest = code.slice(i + m[0].length, i + m[0].length + 24);
        let kind: TokenKind = "plain";
        if (/^[ \t]*\(/.test(rest)) kind = "fn";
        else if (paren === 0 && /^[ \t]*:(?!:)/.test(rest)) kind = "prop";
        out.push(kind, m[0]);
        i += m[0].length;
        continue;
      }
    }
    out.push("plain", c);
    i++;
  }
  return out.tokens;
}

const CSS_AT_RE = /@[A-Za-z-]+/y;
const CSS_HEX_RE = /#[0-9a-fA-F]{3,8}\b/y;
const CSS_NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:%|[A-Za-z]+)?/y;
const CSS_NAME_RE = /-{0,2}[A-Za-z_][\w-]*/y;
const CSS_SEL_RE = /[.#]?:{0,2}-?[A-Za-z_][\w-]*|:{1,2}[A-Za-z-]+/y;

// ------------------------------------------------------------------------------------------------------------ diff

function scanDiff(code: string): Token[] {
  const out = new Out();
  let i = 0;
  while (i < code.length) {
    let e = code.indexOf("\n", i);
    e = e === -1 ? code.length : e + 1;
    const line = code.slice(i, e);
    let kind: TokenKind = "plain";
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) kind = "attr";
    else if (line.startsWith("@@")) kind = "hunk";
    else if (line.startsWith("+")) kind = "add";
    else if (line.startsWith("-")) kind = "del";
    out.push(kind, line);
    i = e;
  }
  return out.tokens;
}

// -------------------------------------------------------------------------------------------------------------- API

/** Tokens for `code` in the language `lang` (a name or alias, see normalizeLang), or null when there is nothing to colour. */
export function highlight(code: string, lang: string): Token[] | null {
  const name = normalizeLang(lang);
  if (!name || code.length > MAX_HIGHLIGHT_CHARS) return null;
  if (name === "html") return scanHtml(code);
  if (name === "css") return scanCss(code);
  if (name === "diff") return scanDiff(code);
  const L = LANGUAGES[name];
  return L ? scanGeneric(code, L) : null;
}
