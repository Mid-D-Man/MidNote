// Backup file container: plain-text DixScript (.mdix).
//
// This is the SAME flat dialect the app already writes for its entries on the phone
// (src-tauri/src/data/mdix_json.rs): `@CONFIG(...)` header, one `@DATA(...)` block, scalar
// fields first, then `name::` group arrays last, values being strings / numbers / true / false /
// null / inline `{ k = v }` objects / inline `[a, b]` arrays. It is plain Typescript on purpose, so it
// runs in the WebView, in the smoke tests and in Node with no native code.
//
// What was checked against the REAL DixScript parser (midmanstudio-mdix, the Python binding of the same
// engine) - the rules below are not guesses:
//   * strings: `\\` `\"` `\n` `\r` `\t` escapes work, `\uXXXX` does NOT (the backslash is dropped), raw
//     Unicode / tabs / control characters are kept as they are. This writer escapes only \ " CR LF.
//   * an array must hold one kind of value: [1, 2.5], [1, 1760000000000], [1, "a"], ["a", true] are all
//     refused by the parser's semantic analysis. So numeric arrays that are not plain small integers
//     are written as floats ("1.0"), and any other mixed array is written as a string `"@json:[...]"`
//     that readMdix turns back into the array. Normal MidNote data never needs that fallback; it exists
//     so a backup can never fail to be written and never loses a value.
//   * an empty inline object `{}` as a field value is dropped by the parser, so it is not written
//     (it reads back as "missing", which every default in storage.ts already handles).
//   * null is accepted next to any single kind of value in an array (checked for strings, ints, floats,
//     longs, bools and objects).
//
// readMdix only has to read what writeMdix wrote (plus whitespace, `//` and block comments, optional
// commas), and it never throws: a bad file gives { ok: false, message }.

export interface MdixDoc {
  /** Scalar fields (any JSON-like value), written first, in this order. */
  scalars: Array<[string, unknown]>;
  /** Group arrays (`name::`), written last, in this order. An empty one is left out. */
  groups: Array<[string, unknown[]]>;
  /** Extra `//` comment lines under the title line. */
  comments?: string[];
}

export type MdixRead = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const JSON_PREFIX = "@json:";
const WRAP_KEY = "_json";
const SMALL_INT = 1_000_000_000;
const MAX_DEPTH = 40;

type Kind = "null" | "bool" | "int" | "long" | "float" | "str" | "arr" | "obj";
interface Rendered {
  t: string;
  k: Kind;
  empty?: boolean;
}

// ------------------------------------------------------------------ writing

function quote(s: string): string {
  if (!/[\\"\r\n]/.test(s)) return `"${s}"`;
  return `"${s.replace(/[\\"\r\n]/g, (c) => (c === "\\" ? "\\\\" : c === '"' ? '\\"' : c === "\r" ? "\\r" : "\\n"))}"`;
}

function str(s: string): string {
  // a user's own text that starts with the marker is wrapped too, so reading can never confuse the two
  return quote(s.startsWith(JSON_PREFIX) ? JSON_PREFIX + JSON.stringify(s) : s);
}

function jsonFallback(v: unknown): Rendered {
  let text: string;
  try {
    text = JSON.stringify(v) ?? "null";
  } catch {
    text = "null";
  }
  return { t: quote(JSON_PREFIX + text), k: "str" };
}

/** A number written so the parser reads it as a float: 1 -> 1.0, 1e+21 -> 1.0e+21 */
function floatForm(n: number): string {
  const s = String(n);
  const m = /^(-?\d+)([eE].*)?$/.exec(s);
  return m ? `${m[1]}.0${m[2] ?? ""}` : s;
}

function renderNumber(n: number): Rendered {
  if (!Number.isFinite(n)) return { t: "null", k: "null" };
  if (!Number.isInteger(n)) return { t: String(n), k: "float" };
  if (Math.abs(n) <= SMALL_INT) return { t: String(n === 0 ? 0 : n), k: "int" };
  if (Math.abs(n) <= 9e15) return { t: String(n), k: "long" };
  return { t: floatForm(n), k: "float" };
}

function render(v: unknown, depth: number): Rendered {
  if (v === null || v === undefined) return { t: "null", k: "null" };
  if (depth > MAX_DEPTH) return jsonFallback(v);
  switch (typeof v) {
    case "boolean":
      return { t: v ? "true" : "false", k: "bool" };
    case "number":
      return renderNumber(v);
    case "string":
      return { t: str(v), k: "str" };
    case "object":
      return Array.isArray(v) ? renderArray(v, depth) : renderObject(v as Record<string, unknown>, depth);
    default:
      return { t: "null", k: "null" }; // functions, symbols, bigint: not part of this data
  }
}

function renderArray(a: unknown[], depth: number): Rendered {
  if (a.length === 0) return { t: "[]", k: "arr" };
  const items = a.map((x) => render(x, depth + 1));
  const kinds = new Set(items.filter((i) => i.k !== "null").map((i) => i.k));
  if (kinds.size === 0) return { t: `[${items.map((i) => i.t).join(", ")}]`, k: "arr" };

  const numeric = [...kinds].every((k) => k === "int" || k === "long" || k === "float");
  if (numeric) {
    if (kinds.size === 1 && kinds.has("int")) return { t: `[${items.map((i) => i.t).join(", ")}]`, k: "arr" };
    // not all small integers: write every number as a float so the array has ONE kind
    return { t: `[${a.map((x) => floatForm(x as number)).join(", ")}]`, k: "arr" };
  }
  if (kinds.size === 1) return { t: `[${items.map((i) => i.t).join(", ")}]`, k: "arr" };
  return jsonFallback(a);
}

function renderObject(o: Record<string, unknown>, depth: number): Rendered {
  const parts: string[] = [];
  for (const key of Object.keys(o)) {
    const val = o[key];
    if (val === undefined) continue;
    if (!IDENT.test(key)) return jsonFallback(o);
    const r = render(val, depth + 1);
    if (r.k === "obj" && r.empty) continue; // the parser drops `{}` fields
    parts.push(`${key} = ${r.t}`);
  }
  if (parts.length === 0) return { t: "{}", k: "obj", empty: true };
  return { t: `{ ${parts.join(", ")} }`, k: "obj" };
}

function groupItem(item: unknown): string {
  const r = render(item, 1);
  if (r.k === "obj") return r.t;
  // a group array holds objects only: anything else travels inside a one-field object
  return `{ ${WRAP_KEY} = ${quote(JSON_PREFIX + (JSON.stringify(item) ?? "null"))} }`;
}

export function writeMdix(doc: MdixDoc): string {
  const out: string[] = ["// Brought to u by MidManStudio"];
  for (const c of doc.comments ?? []) out.push(`// ${c.replace(/[\r\n]+/g, " ")}`);
  out.push("", "@CONFIG(", '  version    -> "1.0.0"', '  features   -> "data"', '  debug_mode -> "off"', ")", "", "@DATA(");
  for (const [key, value] of doc.scalars) {
    if (!IDENT.test(key)) throw new Error(`bad field name ${key}`);
    const r = render(value, 0);
    if (r.k === "obj" && r.empty) continue;
    out.push(`  ${key} = ${r.t}`);
  }
  for (const [key, items] of doc.groups) {
    if (!IDENT.test(key)) throw new Error(`bad field name ${key}`);
    if (items.length === 0) continue;
    out.push(`  ${key}::`);
    out.push(items.map((it) => `    ${groupItem(it)}`).join(",\n"));
  }
  out.push(")", "");
  return out.join("\n");
}

// ------------------------------------------------------------------ reading

class Reader {
  private pos = 0;
  constructor(private readonly s: string) {}

  fail(msg: string): never {
    let line = 1;
    for (let i = 0; i < this.pos && i < this.s.length; i++) if (this.s.charCodeAt(i) === 10) line++;
    throw new MdixError(`${msg} (line ${line})`);
  }

  private ws(): void {
    const s = this.s;
    for (;;) {
      const c = s.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff) {
        this.pos++;
      } else if (c === 47 && s.charCodeAt(this.pos + 1) === 47) {
        const nl = s.indexOf("\n", this.pos);
        this.pos = nl === -1 ? s.length : nl + 1;
      } else if (c === 47 && s.charCodeAt(this.pos + 1) === 42) {
        const end = s.indexOf("*/", this.pos + 2);
        if (end === -1) this.fail("unterminated comment");
        this.pos = end + 2;
      } else return;
    }
  }

  private ident(): string | null {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.pos, this.pos + 80));
    return m ? m[0] : null;
  }

  /** Is the text at pos the start of a new `name =` / `name::` field (not a value)? */
  private atField(): boolean {
    const id = this.ident();
    if (!id || id === "true" || id === "false" || id === "null") return false;
    let p = this.pos + id.length;
    while (this.s.charCodeAt(p) === 32 || this.s.charCodeAt(p) === 9) p++;
    const c = this.s.charCodeAt(p);
    return c === 61 /* = */ || (c === 58 && this.s.charCodeAt(p + 1) === 58);
  }

  private skipBalanced(): void {
    // at the '(' of @CONFIG( ... ): skip to the matching ')', ignoring parens inside strings/comments
    let depth = 0;
    for (;;) {
      this.ws();
      const c = this.s[this.pos];
      if (c === undefined) this.fail("unterminated @CONFIG block");
      if (c === '"') {
        this.string();
        continue;
      }
      this.pos++;
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return;
    }
  }

  private string(): string {
    const s = this.s;
    if (s[this.pos] !== '"') this.fail("expected a string");
    this.pos++;
    let out = "";
    let from = this.pos;
    for (;;) {
      const q = s.indexOf('"', this.pos);
      if (q === -1) this.fail("unterminated string");
      // a quote preceded by an odd number of backslashes is escaped; the escapes are decoded below
      let b = 0;
      for (let i = q - 1; i >= from && s.charCodeAt(i) === 92; i--) b++;
      if (b % 2 === 1) {
        this.pos = q + 1;
        continue;
      }
      out = s.slice(from, q);
      this.pos = q + 1;
      break;
    }
    if (out.indexOf("\\") === -1) return out;
    return out.replace(/\\(.)/gs, (_m, ch: string) => (ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch));
  }

  private number(): number {
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.s.slice(this.pos, this.pos + 40));
    if (!m) this.fail("expected a value");
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) this.fail("number out of range");
    return n;
  }

  value(depth: number): unknown {
    if (depth > 80) this.fail("nested too deeply");
    this.ws();
    const c = this.s[this.pos];
    if (c === '"') return unwrap(this.string());
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return this.number();
    const id = this.ident();
    if (id === "true") {
      this.pos += 4;
      return true;
    }
    if (id === "false") {
      this.pos += 5;
      return false;
    }
    if (id === "null") {
      this.pos += 4;
      return null;
    }
    return this.fail("expected a value");
  }

  private object(depth: number): Record<string, unknown> {
    this.pos++; // {
    const o: Record<string, unknown> = {};
    for (;;) {
      this.ws();
      if (this.s[this.pos] === "}") {
        this.pos++;
        break;
      }
      if (this.s[this.pos] === ",") {
        this.pos++;
        continue;
      }
      const id = this.ident();
      if (!id) this.fail("expected a field name");
      this.pos += id.length;
      this.ws();
      if (this.s[this.pos] !== "=") this.fail("expected '='");
      this.pos++;
      const v = this.value(depth + 1);
      if (id !== "__proto__" && id !== "constructor" && id !== "prototype") o[id] = v;
    }
    return o;
  }

  private array(depth: number): unknown[] {
    this.pos++; // [
    const a: unknown[] = [];
    for (;;) {
      this.ws();
      if (this.s[this.pos] === "]") {
        this.pos++;
        break;
      }
      if (this.s[this.pos] === ",") {
        this.pos++;
        continue;
      }
      if (this.pos >= this.s.length) this.fail("unterminated array");
      a.push(this.value(depth + 1));
    }
    return a;
  }

  document(): Record<string, unknown> {
    this.ws();
    if (this.s.startsWith("@CONFIG", this.pos)) {
      this.pos += 7;
      this.ws();
      if (this.s[this.pos] !== "(") this.fail("expected '(' after @CONFIG");
      this.skipBalanced();
      this.ws();
    }
    if (!this.s.startsWith("@DATA", this.pos)) this.fail("no @DATA block found");
    this.pos += 5;
    this.ws();
    if (this.s[this.pos] !== "(") this.fail("expected '(' after @DATA");
    this.pos++;
    const data: Record<string, unknown> = {};
    for (;;) {
      this.ws();
      const c = this.s[this.pos];
      if (c === undefined) this.fail("the @DATA block is not closed");
      if (c === ")") {
        this.pos++;
        break;
      }
      if (c === ",") {
        this.pos++;
        continue;
      }
      const id = this.ident();
      if (!id) this.fail("expected a field name");
      this.pos += id.length;
      this.ws();
      const safe = id !== "__proto__" && id !== "constructor" && id !== "prototype";
      if (this.s[this.pos] === "=") {
        this.pos++;
        const v = this.value(0);
        if (safe) data[id] = v;
      } else if (this.s[this.pos] === ":" && this.s[this.pos + 1] === ":") {
        this.pos += 2;
        const items: unknown[] = [];
        for (;;) {
          this.ws();
          if (this.s[this.pos] === ")" || this.pos >= this.s.length || this.atField()) break;
          items.push(unwrapItem(this.value(1)));
          this.ws();
          if (this.s[this.pos] === ",") this.pos++;
          else break;
        }
        if (safe) data[id] = items;
      } else {
        this.fail("expected '=' or '::'");
      }
    }
    this.ws();
    if (this.pos < this.s.length) this.fail("unexpected text after the @DATA block");
    return data;
  }
}

class MdixError extends Error {}

function unwrap(s: string): unknown {
  if (!s.startsWith(JSON_PREFIX)) return s;
  try {
    return JSON.parse(s.slice(JSON_PREFIX.length));
  } catch {
    return s;
  }
}

function unwrapItem(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === WRAP_KEY) {
      const inner = (v as Record<string, unknown>)[WRAP_KEY];
      // the string was already unwrapped by value(): it IS the original item
      return inner;
    }
  }
  return v;
}

export function readMdix(text: string): MdixRead {
  try {
    return { ok: true, data: new Reader(text).document() };
  } catch (err) {
    if (err instanceof MdixError) return { ok: false, message: err.message };
    return { ok: false, message: "The file could not be read." };
  }
}
