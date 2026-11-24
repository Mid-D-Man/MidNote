// The structure of a PDF file: its objects, found by SCANNING the bytes for "N G obj" (not by trusting the cross-reference table,
// which is the part of damaged and hand-patched files that is most often wrong). Where an object is defined twice (an updated file)
// the later one wins, as in the format's own rule. Objects packed inside object streams (PDF 1.5+) are unpacked and added the same way.
// Part of the PDF text reader (pdfText.ts); no new package.
//
// DATA ONLY. Nothing in the file is run or opened: JavaScript, actions, links, embedded files and forms are never touched.
// Encrypted files are refused (their text can't be read without decrypting it). Everything is bounded: nesting depth, objects per
// object stream, and the size any stream may unpack to.
import { PdfError, applyPredictor, ascii85Decode, asciiHexDecode, inflateZlib, lzwDecode, runLengthDecode, MAX_STREAM_BYTES } from "$lib/utils/pdfFilters";

export class PdfName {
  constructor(public readonly name: string) {}
}
export class PdfRef {
  constructor(
    public readonly num: number,
    public readonly gen: number,
  ) {}
}
export class PdfStream {
  constructor(
    public readonly dict: PdfDict,
    public readonly start: number,
    public readonly end: number,
  ) {}
}
export type PdfDict = Map<string, PdfValue>;
/** A string is its raw bytes (Uint8Array). */
export type PdfValue = null | boolean | number | PdfName | Uint8Array | PdfRef | PdfValue[] | PdfDict | PdfStream;

// ------------------------------------------------------------------ lexer

export type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "str"; v: Uint8Array } | { t: "kw"; v: string } | { t: "[" } | { t: "]" } | { t: "<<" } | { t: ">>" } | { t: "eof" };

const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
const isRegular = (c: number) => !isWs(c) && !isDelim(c);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const hexVal = (c: number) => (c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x41 + 10 : c >= 0x61 && c <= 0x66 ? c - 0x61 + 10 : -1);

export class Lexer {
  constructor(
    public buf: Uint8Array,
    public pos = 0,
    private end = buf.length,
  ) {}

  private skipWs(): void {
    const b = this.buf;
    while (this.pos < this.end) {
      const c = b[this.pos];
      if (isWs(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < this.end && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  next(): Tok {
    this.skipWs();
    const b = this.buf;
    if (this.pos >= this.end) return { t: "eof" };
    const c = b[this.pos];
    if (c === 0x5b) { this.pos++; return { t: "[" }; }
    if (c === 0x5d) { this.pos++; return { t: "]" }; }
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) { this.pos += 2; return { t: "<<" }; }
      return this.hexString();
    }
    if (c === 0x3e) {
      if (b[this.pos + 1] === 0x3e) { this.pos += 2; return { t: ">>" }; }
      this.pos++;
      return this.next(); // a stray ">" is skipped
    }
    if (c === 0x28) return this.literalString();
    if (c === 0x2f) return this.name();
    if (c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return this.next(); // stray ")" and the braces of PostScript functions are skipped
    }
    const s = this.pos;
    while (this.pos < this.end && isRegular(b[this.pos])) this.pos++;
    let word = "";
    for (let i = s; i < this.pos; i++) word += String.fromCharCode(b[i]);
    if (NUMBER.test(word)) return { t: "num", v: parseFloat(word) };
    return { t: "kw", v: word };
  }

  private name(): Tok {
    const b = this.buf;
    this.pos++; // "/"
    let s = "";
    while (this.pos < this.end && isRegular(b[this.pos])) {
      const c = b[this.pos];
      if (c === 0x23 && this.pos + 2 < this.end + 0 && hexVal(b[this.pos + 1]) >= 0 && hexVal(b[this.pos + 2]) >= 0) {
        s += String.fromCharCode(hexVal(b[this.pos + 1]) * 16 + hexVal(b[this.pos + 2]));
        this.pos += 3;
      } else {
        s += String.fromCharCode(c);
        this.pos++;
      }
    }
    return { t: "name", v: s };
  }

  private hexString(): Tok {
    const b = this.buf;
    this.pos++; // "<"
    const out: number[] = [];
    let hi = -1;
    while (this.pos < this.end) {
      const c = b[this.pos++];
      if (c === 0x3e) break;
      const v = hexVal(c);
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4);
    return { t: "str", v: Uint8Array.from(out) };
  }

  private literalString(): Tok {
    const b = this.buf;
    this.pos++; // "("
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.end) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        const e = b[this.pos++];
        if (e === undefined) break;
        if (e === 0x6e) out.push(0x0a);
        else if (e === 0x72) out.push(0x0d);
        else if (e === 0x74) out.push(0x09);
        else if (e === 0x62) out.push(0x08);
        else if (e === 0x66) out.push(0x0c);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let k = 0; k < 2 && this.pos < this.end && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; k++) v = v * 8 + (b[this.pos++] - 0x30);
          out.push(v & 0xff);
        } else if (e === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++; // line continuation
        } else if (e === 0x0a) {
          // line continuation
        } else out.push(e); // \( \) \\ and any other escaped character stand for themselves
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        depth--;
        if (depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return { t: "str", v: Uint8Array.from(out) };
  }
}

const MAX_DEPTH = 64;

/** A whole value, given its first token already read. Operators and other keywords (not true/false/null) come back as null. */
export function parseFrom(lx: Lexer, first: Tok, allowRefs: boolean, depth = 0): PdfValue {
  if (depth > MAX_DEPTH) throw new PdfError("bad-data", "That PDF is damaged.");
  switch (first.t) {
    case "num": {
      if (allowRefs && Number.isInteger(first.v) && first.v >= 0) {
        const save = lx.pos;
        const t2 = lx.next();
        if (t2.t === "num" && Number.isInteger(t2.v) && t2.v >= 0) {
          const t3 = lx.next();
          if (t3.t === "kw" && t3.v === "R") return new PdfRef(first.v, t2.v);
        }
        lx.pos = save;
      }
      return first.v;
    }
    case "name": return new PdfName(first.v);
    case "str": return first.v;
    case "kw": return first.v === "true" ? true : first.v === "false" ? false : null;
    case "[": {
      const arr: PdfValue[] = [];
      for (;;) {
        const t = lx.next();
        if (t.t === "]" || t.t === "eof") break;
        if (t.t === ">>") continue;
        arr.push(parseFrom(lx, t, allowRefs, depth + 1));
      }
      return arr;
    }
    case "<<": {
      const dict: PdfDict = new Map();
      for (;;) {
        const k = lx.next();
        if (k.t === ">>" || k.t === "eof") break;
        if (k.t !== "name") continue; // damaged: skip until the next key
        const vt = lx.next();
        if (vt.t === ">>" || vt.t === "eof") break;
        dict.set(k.v, parseFrom(lx, vt, allowRefs, depth + 1));
      }
      return dict;
    }
    default: return null;
  }
}

// ------------------------------------------------------------------ the document

function indexOfBytes(b: Uint8Array, pat: string, from: number): number {
  const n = pat.length;
  const first = pat.charCodeAt(0);
  outer: for (let i = from; i + n <= b.length; i++) {
    if (b[i] !== first) continue;
    for (let k = 1; k < n; k++) if (b[i + k] !== pat.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

const matchesAt = (b: Uint8Array, i: number, word: string): boolean => {
  if (i < 0 || i + word.length > b.length) return false;
  for (let k = 0; k < word.length; k++) if (b[i + k] !== word.charCodeAt(k)) return false;
  return true;
};

const FILTER_NAMES: Record<string, string> = { Fl: "FlateDecode", AHx: "ASCIIHexDecode", A85: "ASCII85Decode", LZW: "LZWDecode", RL: "RunLengthDecode", CCF: "CCITTFaxDecode", DCT: "DCTDecode" };

const MAX_OBJSTM_OBJECTS = 200_000;

export class PdfDoc {
  readonly defs = new Map<number, { pos: number; value: PdfValue }>();
  readonly trailers: PdfDict[] = [];
  private objStreams: { num: number; pos: number; stream: PdfStream }[] = [];

  private constructor(readonly bytes: Uint8Array) {}

  /** Reads the structure of a PDF. Null when the bytes don't start like a PDF; throws PdfError for encrypted or hopelessly damaged files. */
  static async open(bytes: Uint8Array): Promise<PdfDoc | null> {
    const head = Math.min(bytes.length, 1024);
    if (indexOfBytes(bytes.subarray(0, head), "%PDF-", 0) < 0) return null;
    const doc = new PdfDoc(bytes);
    doc.scan();
    if (doc.trailers.some((t) => t.has("Encrypt"))) throw new PdfError("encrypted", "This PDF is password-protected or encrypted, which MidNote can't open yet.");
    await doc.unpackObjectStreams();
    return doc;
  }

  private scan(): void {
    const b = this.bytes;
    const n = b.length;
    let i = 0;
    while (i < n) {
      const c = b[i];
      if (c === 0x6f && b[i + 1] === 0x62 && b[i + 2] === 0x6a && i > 0 && isWs(b[i - 1]) && (i + 3 >= n || !isRegular(b[i + 3]))) {
        // "obj": walk back over "<num> <gen> "
        let p = i - 1;
        while (p >= 0 && isWs(b[p])) p--;
        const genEnd = p + 1;
        while (p >= 0 && b[p] >= 0x30 && b[p] <= 0x39) p--;
        const genStart = p + 1;
        if (genStart < genEnd && p >= 0 && isWs(b[p])) {
          while (p >= 0 && isWs(b[p])) p--;
          const numEnd = p + 1;
          while (p >= 0 && b[p] >= 0x30 && b[p] <= 0x39) p--;
          const numStart = p + 1;
          if (numStart < numEnd && numEnd - numStart <= 10 && (p < 0 || !isRegular(b[p]))) {
            let num = 0;
            for (let k = numStart; k < numEnd; k++) num = num * 10 + (b[k] - 0x30);
            try {
              i = this.readObject(num, i + 3);
              continue;
            } catch (e) {
              if (e instanceof PdfError && e.kind !== "bad-data") throw e;
            }
          }
        }
        i += 3;
        continue;
      }
      if (c === 0x74 && matchesAt(b, i, "trailer") && (i === 0 || !isRegular(b[i - 1]))) {
        try {
          const lx = new Lexer(b, i + 7);
          const t = lx.next();
          if (t.t === "<<") {
            const d = parseFrom(lx, t, true);
            if (d instanceof Map) this.trailers.push(d);
          }
          i = Math.max(i + 7, lx.pos);
          continue;
        } catch {
          /* skip */
        }
        i += 7;
        continue;
      }
      i++;
    }
  }

  /** Reads the object whose body starts at `pos` (just after "obj"); returns where scanning continues. */
  private readObject(num: number, pos: number): number {
    const b = this.bytes;
    const lx = new Lexer(b, pos);
    const first = lx.next();
    if (first.t === "kw" && first.v === "endobj") {
      this.defs.set(num, { pos, value: null });
      return lx.pos;
    }
    const value = parseFrom(lx, first, true);
    if (value instanceof Map) {
      const save = lx.pos;
      const t = lx.next();
      if (t.t === "kw" && t.v === "stream") {
        let start = lx.pos;
        if (b[start] === 0x0d && b[start + 1] === 0x0a) start += 2;
        else if (b[start] === 0x0a || b[start] === 0x0d) start += 1;
        let end = -1;
        const len = value.get("Length");
        if (typeof len === "number" && len >= 0 && start + len <= b.length) {
          let q = start + len;
          for (let k = 0; k < 4 && q < b.length && isWs(b[q]); k++) q++;
          if (matchesAt(b, q, "endstream")) end = start + len;
        }
        if (end < 0) {
          const found = indexOfBytes(b, "endstream", start);
          end = found < 0 ? b.length : found;
          if (found >= 0) {
            if (end > start && b[end - 1] === 0x0a) end--;
            if (end > start && b[end - 1] === 0x0d) end--;
          }
        }
        const stream = new PdfStream(value, start, end);
        this.defs.set(num, { pos, value: stream });
        const type = value.get("Type");
        if (type instanceof PdfName && type.name === "ObjStm") this.objStreams.push({ num, pos, stream });
        else if (type instanceof PdfName && type.name === "XRef") this.trailers.push(value);
        return end;
      }
      lx.pos = save;
    }
    this.defs.set(num, { pos, value });
    return lx.pos;
  }

  private async unpackObjectStreams(): Promise<void> {
    for (const os of this.objStreams) {
      let data: Uint8Array | null;
      try {
        data = await this.streamBytes(os.stream);
      } catch (e) {
        if (e instanceof PdfError && e.kind === "too-large") throw e;
        continue;
      }
      if (!data) continue;
      const nObj = this.numOf(os.stream.dict.get("N") ?? null);
      const first = this.numOf(os.stream.dict.get("First") ?? null);
      if (nObj === null || first === null || nObj < 0 || nObj > MAX_OBJSTM_OBJECTS || first < 0 || first > data.length) continue;
      const head = new Lexer(data, 0, first);
      const pairs: [number, number][] = [];
      for (let k = 0; k < nObj; k++) {
        const a = head.next();
        const o = head.next();
        if (a.t !== "num" || o.t !== "num") break;
        pairs.push([a.v, o.v]);
      }
      for (const [objNum, off] of pairs) {
        if (first + off >= data.length) continue;
        const existing = this.defs.get(objNum);
        if (existing && existing.pos > os.pos) continue; // a later update of that object wins
        try {
          const lx = new Lexer(data, first + off);
          const v = parseFrom(lx, lx.next(), true);
          this.defs.set(objNum, { pos: os.pos, value: v });
        } catch {
          /* skip this object */
        }
      }
    }
    this.objStreams = [];
  }

  // ---------------------------------------------------------------- reading values

  resolve(v: PdfValue): PdfValue {
    let cur = v;
    for (let k = 0; k < 32 && cur instanceof PdfRef; k++) cur = this.defs.get(cur.num)?.value ?? null;
    return cur instanceof PdfRef ? null : cur;
  }
  dictOf(v: PdfValue): PdfDict | null {
    const r = this.resolve(v);
    if (r instanceof Map) return r;
    if (r instanceof PdfStream) return r.dict;
    return null;
  }
  arrayOf(v: PdfValue): PdfValue[] | null {
    const r = this.resolve(v);
    return Array.isArray(r) ? r : null;
  }
  numOf(v: PdfValue): number | null {
    const r = this.resolve(v);
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  }
  nameOf(v: PdfValue): string | null {
    const r = this.resolve(v);
    return r instanceof PdfName ? r.name : null;
  }

  /**
   * The decoded bytes of a stream (filters undone). Null when the value isn't a stream or its packing is one we can't undo (pictures).
   * With `jpegOk`, a stream whose LAST filter is DCTDecode gives the JPEG file itself (a JPEG is already a picture a browser can draw).
   */
  async streamBytes(v: PdfValue, jpegOk = false): Promise<Uint8Array | null> {
    const s = this.resolve(v);
    if (!(s instanceof PdfStream)) return null;
    let data: Uint8Array = this.bytes.subarray(s.start, s.end);
    const fv = this.resolve(s.dict.get("Filter") ?? s.dict.get("F") ?? null);
    const filters: string[] = [];
    if (fv instanceof PdfName) filters.push(fv.name);
    else if (Array.isArray(fv)) for (const f of fv) {
      const nm = this.nameOf(f);
      if (nm) filters.push(nm);
    }
    const pv = this.resolve(s.dict.get("DecodeParms") ?? s.dict.get("DP") ?? null);
    const parmsFor = (idx: number): PdfDict | null => {
      if (pv instanceof Map) return idx === 0 ? pv : null;
      if (Array.isArray(pv)) return this.dictOf(pv[idx] ?? null);
      return null;
    };
    for (let idx = 0; idx < filters.length; idx++) {
      const name = FILTER_NAMES[filters[idx]] ?? filters[idx];
      const parms = parmsFor(idx);
      const pn = (key: string, dflt: number) => (parms ? (this.numOf(parms.get(key) ?? null) ?? dflt) : dflt);
      if (name === "FlateDecode") {
        data = await inflateZlib(data, MAX_STREAM_BYTES);
        data = applyPredictor(data, pn("Predictor", 1), pn("Colors", 1), pn("BitsPerComponent", 8), pn("Columns", 1));
      } else if (name === "LZWDecode") {
        data = lzwDecode(data, pn("EarlyChange", 1));
        data = applyPredictor(data, pn("Predictor", 1), pn("Colors", 1), pn("BitsPerComponent", 8), pn("Columns", 1));
      } else if (name === "ASCIIHexDecode") data = asciiHexDecode(data);
      else if (name === "ASCII85Decode") data = ascii85Decode(data);
      else if (name === "RunLengthDecode") data = runLengthDecode(data);
      else if (name === "Crypt") continue;
      else if (jpegOk && name === "DCTDecode" && idx === filters.length - 1) break; // the bytes now are a JPEG file
      else return null; // DCTDecode, JPXDecode, CCITTFaxDecode, JBIG2Decode: pictures, not text
    }
    return data;
  }

  /** The catalog (document root) dictionary. */
  catalog(): PdfDict | null {
    for (let i = this.trailers.length - 1; i >= 0; i--) {
      const root = this.dictOf(this.trailers[i].get("Root") ?? null);
      if (root) return root;
    }
    let best: PdfDict | null = null;
    for (const { value } of this.defs.values()) {
      if (value instanceof Map && this.nameOf(value.get("Type") ?? null) === "Catalog") best = value;
    }
    return best;
  }

  /** Every page in order, with the resources it inherits. Falls back to every /Page object by number when the page tree is unusable. */
  pages(max: number): { page: PdfDict; resources: PdfValue }[] {
    const out: { page: PdfDict; resources: PdfValue }[] = [];
    const seen = new Set<number>();
    const walk = (nodeRef: PdfValue, inherited: PdfValue, depth: number) => {
      if (out.length >= max || depth > 40) return;
      if (nodeRef instanceof PdfRef) {
        if (seen.has(nodeRef.num)) return;
        seen.add(nodeRef.num);
      }
      const node = this.dictOf(nodeRef);
      if (!node) return;
      const res = node.has("Resources") ? (node.get("Resources") ?? null) : inherited;
      const kids = this.arrayOf(node.get("Kids") ?? null);
      if (kids) {
        for (const k of kids) walk(k, res, depth + 1);
      } else if (this.nameOf(node.get("Type") ?? null) !== "Pages") {
        out.push({ page: node, resources: res });
      }
    };
    const cat = this.catalog();
    if (cat) walk(cat.get("Pages") ?? null, null, 0);
    if (out.length === 0) {
      const nums = [...this.defs.keys()].sort((a, b) => a - b);
      for (const num of nums) {
        const v = this.defs.get(num)!.value;
        if (v instanceof Map && this.nameOf(v.get("Type") ?? null) === "Page") {
          out.push({ page: v, resources: v.get("Resources") ?? null });
          if (out.length >= max) break;
        }
      }
    }
    return out;
  }
}
