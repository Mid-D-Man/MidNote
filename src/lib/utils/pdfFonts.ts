// How the text of a PDF is spelled: a PDF does not store letters, it stores CODES drawn with a font, and the font says what each
// code means. This turns codes back into text, in the order of how trustworthy the source is:
//   1. the font's /ToUnicode map (written for copy-and-paste; modern producers all include one)
//   2. its /Encoding (a named standard encoding plus a /Differences list of glyph names)
//   3. for the simple fonts with neither: the standard encoding
// Part of the PDF text reader (pdfText.ts); no new package. Glyph widths are kept too, only to decide where the gaps between words are.
import { Lexer, PdfName, PdfStream, type PdfDict, type PdfDoc, type PdfValue } from "$lib/utils/pdfObjects";

export interface Decoded {
  text: string;
  /** Sum of the glyph widths, in thousandths of the font size. */
  width: number;
  glyphs: number;
  /** How many were the single-byte space code (32), the only code the word-spacing setting applies to. */
  spaces: number;
  /** How many codes had no text we could find (shown as nothing). */
  unmapped: number;
}

export interface PdfFont {
  decode(s: Uint8Array): Decoded;
}

// ------------------------------------------------------------------ glyph names -> text

const GLYPHS: Record<string, string> = {};
const addGlyphs = (list: string, firstCode: number) => {
  list.split(" ").forEach((n, i) => (GLYPHS[n] = String.fromCharCode(firstCode + i)));
};
// ASCII, in code order from 0x20
addGlyphs("space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at", 0x20);
addGlyphs("bracketleft backslash bracketright asciicircum underscore grave", 0x5b);
addGlyphs("braceleft bar braceright asciitilde", 0x7b);
for (let c = 0x41; c <= 0x5a; c++) GLYPHS[String.fromCharCode(c)] = String.fromCharCode(c);
for (let c = 0x61; c <= 0x7a; c++) GLYPHS[String.fromCharCode(c)] = String.fromCharCode(c);
// Latin-1 upper half, in code order from 0xA0
addGlyphs(
  "nbspace exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot sfthyphen registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis",
  0xa0,
);
GLYPHS.nbspace = " ";
GLYPHS.sfthyphen = "-";
const EXTRA: Record<string, string> = {
  Lslash: "\u0141", lslash: "\u0142", OE: "\u0152", oe: "\u0153", Scaron: "\u0160", scaron: "\u0161", Ydieresis: "\u0178", Zcaron: "\u017d", zcaron: "\u017e", florin: "\u0192", circumflex: "\u02c6", tilde: "\u02dc", dotlessi: "\u0131",
  Abreve: "\u0102", abreve: "\u0103", Aogonek: "\u0104", aogonek: "\u0105", Cacute: "\u0106", cacute: "\u0107", Ccaron: "\u010c", ccaron: "\u010d", Dcaron: "\u010e", dcaron: "\u010f", Dcroat: "\u0110", dcroat: "\u0111",
  Eogonek: "\u0118", eogonek: "\u0119", Ecaron: "\u011a", ecaron: "\u011b", Gbreve: "\u011e", gbreve: "\u011f", Idotaccent: "\u0130", Nacute: "\u0143", nacute: "\u0144", Ncaron: "\u0147", ncaron: "\u0148",
  Odblacute: "\u0150", odblacute: "\u0151", Rcaron: "\u0158", rcaron: "\u0159", Sacute: "\u015a", sacute: "\u015b", Scedilla: "\u015e", scedilla: "\u015f", Tcaron: "\u0164", tcaron: "\u0165", Uring: "\u016e", uring: "\u016f",
  Udblacute: "\u0170", udblacute: "\u0171", Zacute: "\u0179", zacute: "\u017a", Zdotaccent: "\u017b", zdotaccent: "\u017c", breve: "\u02d8", dotaccent: "\u02d9", ring: "\u02da", ogonek: "\u02db", hungarumlaut: "\u02dd", caron: "\u02c7",
  endash: "\u2013", emdash: "\u2014", quoteleft: "\u2018", quoteright: "\u2019", quotesinglbase: "\u201a", quotedblleft: "\u201c", quotedblright: "\u201d", quotedblbase: "\u201e", dagger: "\u2020", daggerdbl: "\u2021", bullet: "\u2022",
  ellipsis: "\u2026", perthousand: "\u2030", guilsinglleft: "\u2039", guilsinglright: "\u203a", fraction: "\u2044", Euro: "\u20ac", trademark: "\u2122", minus: "\u2212", middot: "\u00b7", hyphenminus: "-", nonbreakingspace: " ",
  fi: "fi", fl: "fl", ff: "ff", ffi: "ffi", ffl: "ffl",
  alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3", delta: "\u03b4", epsilon: "\u03b5", zeta: "\u03b6", eta: "\u03b7", theta: "\u03b8", iota: "\u03b9", kappa: "\u03ba", lambda: "\u03bb", nu: "\u03bd", xi: "\u03be", omicron: "\u03bf", pi: "\u03c0", rho: "\u03c1", sigma: "\u03c3", tau: "\u03c4", upsilon: "\u03c5", phi: "\u03c6", chi: "\u03c7", psi: "\u03c8", omega: "\u03c9",
  Gamma: "\u0393", Delta: "\u0394", Theta: "\u0398", Lambda: "\u039b", Xi: "\u039e", Pi: "\u03a0", Sigma: "\u03a3", Phi: "\u03a6", Psi: "\u03a8", Omega: "\u03a9",
  infinity: "\u221e", partialdiff: "\u2202", summation: "\u2211", product: "\u220f", integral: "\u222b", radical: "\u221a", lessequal: "\u2264", greaterequal: "\u2265", notequal: "\u2260", approxequal: "\u2248", equivalence: "\u2261",
  arrowright: "\u2192", arrowleft: "\u2190", arrowup: "\u2191", arrowdown: "\u2193", arrowboth: "\u2194", element: "\u2208", universal: "\u2200", existential: "\u2203", emptyset: "\u2205", nabla: "\u2207", propersubset: "\u2282", union: "\u222a", intersection: "\u2229", asteriskmath: "\u2217",
};
Object.assign(GLYPHS, EXTRA);

/** The text a glyph name stands for (Adobe's names, "uni00E9", "u1F600", "f_i", "a.sc"); undefined when it is a font-private name like "g12". */
export function glyphToText(name: string): string | undefined {
  if (name === ".notdef" || name === "") return undefined;
  const base = name.split(".")[0];
  if (base === "") return undefined;
  const direct = GLYPHS[base];
  if (direct !== undefined) return direct;
  if (base.includes("_")) {
    const parts = base.split("_").map((p) => glyphToText(p));
    return parts.every((p) => p !== undefined) ? parts.join("") : undefined;
  }
  let m = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(base);
  if (m) {
    let s = "";
    for (let i = 0; i < m[1].length; i += 4) s += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16));
    return s;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (m) {
    const cp = parseInt(m[1], 16);
    if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) return String.fromCodePoint(cp);
  }
  return undefined;
}

// ------------------------------------------------------------------ standard encodings (code -> text)

let winAnsi: string[] | null = null;
let macRoman: string[] | null = null;
let standard: string[] | null = null;

function viaDecoder(label: string): string[] {
  const dec = new TextDecoder(label);
  const out: string[] = [];
  for (let c = 0; c < 256; c++) out.push(c < 0x20 ? "" : dec.decode(Uint8Array.of(c)));
  return out;
}

export function winAnsiTable(): string[] {
  if (winAnsi) return winAnsi;
  const t = viaDecoder("windows-1252");
  t[0xa0] = " "; // a non-breaking space reads as a space
  t[0xad] = "-"; // a soft hyphen as a hyphen
  t[0x7f] = "\u2022"; // WinAnsi as PDF defines it has a bullet here
  return (winAnsi = t);
}
export function macRomanTable(): string[] {
  if (macRoman) return macRoman;
  const t = viaDecoder("macintosh");
  t[0xca] = " "; // the non-breaking space is at 0xCA in MacRoman (0xA0 is a dagger there)
  return (macRoman = t);
}
export function standardTable(): string[] {
  if (standard) return standard;
  const t: string[] = [];
  for (let c = 0; c < 256; c++) t.push(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : "");
  t[0x27] = "\u2019";
  t[0x60] = "\u2018";
  const upper: Record<number, string> = {
    0xa1: "\u00a1", 0xa2: "\u00a2", 0xa3: "\u00a3", 0xa4: "\u2044", 0xa5: "\u00a5", 0xa6: "\u0192", 0xa7: "\u00a7", 0xa8: "\u00a4", 0xa9: "'", 0xaa: "\u201c", 0xab: "\u00ab", 0xac: "\u2039", 0xad: "\u203a", 0xae: "fi", 0xaf: "fl",
    0xb1: "\u2013", 0xb2: "\u2020", 0xb3: "\u2021", 0xb4: "\u00b7", 0xb6: "\u00b6", 0xb7: "\u2022", 0xb8: "\u201a", 0xb9: "\u201e", 0xba: "\u201d", 0xbb: "\u00bb", 0xbc: "\u2026", 0xbd: "\u2030", 0xbf: "\u00bf",
    0xc1: "`", 0xc2: "\u00b4", 0xc3: "\u02c6", 0xc4: "\u02dc", 0xc5: "\u00af", 0xc6: "\u02d8", 0xc7: "\u02d9", 0xc8: "\u00a8", 0xca: "\u02da", 0xcb: "\u00b8", 0xcd: "\u02dd", 0xce: "\u02db", 0xcf: "\u02c7", 0xd0: "\u2014",
    0xe1: "\u00c6", 0xe3: "\u00aa", 0xe8: "\u0141", 0xe9: "\u00d8", 0xea: "\u0152", 0xeb: "\u00ba", 0xf1: "\u00e6", 0xf5: "\u0131", 0xf8: "\u0142", 0xf9: "\u00f8", 0xfa: "\u0153", 0xfb: "\u00df",
  };
  for (const [k, v] of Object.entries(upper)) t[Number(k)] = v;
  return (standard = t);
}

// ------------------------------------------------------------------ CMaps

export interface CMap {
  /** How many bytes a code has, by range. */
  codespaces: { bytes: number; lo: number; hi: number }[];
  /** code -> text (ToUnicode). */
  bf: Map<number, string>;
  /** code -> character id (a font's own encoding CMap). */
  cids: Map<number, number>;
  cidRanges: { lo: number; hi: number; cid: number }[];
}

const MAX_CMAP_ENTRIES = 400_000;
const MAX_RANGE = 0xffff;

function bytesToNumber(b: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < b.length && i < 4; i++) v = v * 256 + b[i];
  return v;
}
/** A font's text for a code. A tab or line break there is always the SPACE glyph (some producers write it that way), never layout. */
function utf16be(b: Uint8Array): string {
  let s = "";
  if (b.length === 1) s = String.fromCharCode(b[0]);
  else for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s.replace(/[\t\n\r]/g, " ");
}

export function parseCMap(data: Uint8Array): CMap {
  const cm: CMap = { codespaces: [], bf: new Map(), cids: new Map(), cidRanges: [] };
  const lx = new Lexer(data);
  let count = 0;
  for (let guard = 0; guard < 5_000_000; guard++) {
    const t = lx.next();
    if (t.t === "eof") break;
    if (t.t !== "kw") continue;
    if (t.v === "begincodespacerange") {
      for (;;) {
        const a = lx.next();
        if (a.t !== "str") break;
        const b = lx.next();
        if (b.t !== "str") break;
        cm.codespaces.push({ bytes: a.v.length, lo: bytesToNumber(a.v), hi: bytesToNumber(b.v) });
      }
    } else if (t.v === "beginbfchar") {
      for (;;) {
        const a = lx.next();
        if (a.t !== "str") break;
        const b = lx.next();
        if (b.t === "str") cm.bf.set(bytesToNumber(a.v), utf16be(b.v));
        else if (b.t === "name") {
          const g = glyphToText(b.v);
          if (g !== undefined) cm.bf.set(bytesToNumber(a.v), g);
        } else break;
        if (++count > MAX_CMAP_ENTRIES) return cm;
      }
    } else if (t.v === "beginbfrange") {
      for (;;) {
        const a = lx.next();
        if (a.t !== "str") break;
        const b = lx.next();
        if (b.t !== "str") break;
        const lo = bytesToNumber(a.v);
        const hi = Math.min(bytesToNumber(b.v), lo + MAX_RANGE);
        const d = lx.next();
        if (d.t === "str") {
          const base = utf16be(d.v);
          for (let c = lo; c <= hi; c++) {
            if (base.length === 0) break;
            cm.bf.set(c, base.slice(0, -1) + String.fromCharCode((base.charCodeAt(base.length - 1) + (c - lo)) & 0xffff));
            if (++count > MAX_CMAP_ENTRIES) return cm;
          }
        } else if (d.t === "[") {
          for (let c = lo; ; c++) {
            const e = lx.next();
            if (e.t === "]" || e.t === "eof") break;
            if (e.t === "str" && c <= hi) cm.bf.set(c, utf16be(e.v));
            if (++count > MAX_CMAP_ENTRIES) return cm;
          }
        } else break;
      }
    } else if (t.v === "begincidrange") {
      for (;;) {
        const a = lx.next();
        if (a.t !== "str") break;
        const b = lx.next();
        const c = lx.next();
        if (b.t !== "str" || c.t !== "num") break;
        cm.cidRanges.push({ lo: bytesToNumber(a.v), hi: bytesToNumber(b.v), cid: c.v });
        if (++count > MAX_CMAP_ENTRIES) return cm;
      }
    } else if (t.v === "begincidchar") {
      for (;;) {
        const a = lx.next();
        if (a.t !== "str") break;
        const c = lx.next();
        if (c.t !== "num") break;
        cm.cids.set(bytesToNumber(a.v), c.v);
        if (++count > MAX_CMAP_ENTRIES) return cm;
      }
    }
  }
  return cm;
}

// ------------------------------------------------------------------ fonts

const EMPTY: Decoded = { text: "", width: 0, glyphs: 0, spaces: 0, unmapped: 0 };

async function toUnicodeOf(doc: PdfDoc, fd: PdfDict): Promise<CMap | null> {
  const tu = doc.resolve(fd.get("ToUnicode") ?? null);
  if (!(tu instanceof PdfStream)) return null;
  try {
    const data = await doc.streamBytes(tu);
    return data ? parseCMap(data) : null;
  } catch {
    return null;
  }
}

async function loadSimple(doc: PdfDoc, fd: PdfDict, subtype: string): Promise<PdfFont> {
  const table: (string | undefined)[] = (subtype === "TrueType" ? winAnsiTable() : standardTable()).slice();
  const enc = doc.resolve(fd.get("Encoding") ?? null);
  const applyBase = (name: string | null) => {
    const base = name === "WinAnsiEncoding" ? winAnsiTable() : name === "MacRomanEncoding" ? macRomanTable() : name === "StandardEncoding" ? standardTable() : null;
    if (base) for (let c = 0; c < 256; c++) table[c] = base[c];
  };
  if (enc instanceof PdfName) applyBase(enc.name);
  else if (enc instanceof Map) {
    applyBase(doc.nameOf(enc.get("BaseEncoding") ?? null));
    const diffs = doc.arrayOf(enc.get("Differences") ?? null);
    if (diffs) {
      let code = 0;
      for (const item of diffs) {
        const r = doc.resolve(item);
        if (typeof r === "number") code = r;
        else if (r instanceof PdfName) {
          if (code >= 0 && code < 256) table[code] = glyphToText(r.name);
          code++;
        }
      }
    }
  }
  const tu = await toUnicodeOf(doc, fd);
  if (tu) for (const [code, text] of tu.bf) if (code >= 0 && code < 256) table[code] = text;

  const desc = doc.dictOf(fd.get("FontDescriptor") ?? null);
  const missing = desc ? (doc.numOf(desc.get("MissingWidth") ?? null) ?? 0) : 0;
  const baseFont = doc.nameOf(fd.get("BaseFont") ?? null) ?? "";
  const dflt = missing > 0 ? missing : /courier/i.test(baseFont) ? 600 : 500;
  const first = doc.numOf(fd.get("FirstChar") ?? null) ?? 0;
  const wArr = doc.arrayOf(fd.get("Widths") ?? null);
  let scale = 1;
  if (subtype === "Type3") {
    const fm = doc.arrayOf(fd.get("FontMatrix") ?? null);
    const s0 = fm ? doc.numOf(fm[0] ?? null) : null;
    if (s0 !== null && s0 > 0) scale = s0 * 1000;
  }
  const widths = new Float32Array(256).fill(dflt);
  if (wArr) {
    for (let i = 0; i < wArr.length && first + i < 256; i++) {
      const w = doc.numOf(wArr[i] ?? null);
      if (w !== null && first + i >= 0) widths[first + i] = w * scale;
    }
  }
  return {
    decode(s: Uint8Array): Decoded {
      let text = "";
      let width = 0;
      let spaces = 0;
      let unmapped = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        const t = table[c];
        if (t === undefined) unmapped++;
        else text += t;
        width += widths[c];
        if (c === 32) spaces++;
      }
      return { text, width, glyphs: s.length, spaces, unmapped };
    },
  };
}

async function loadType0(doc: PdfDoc, fd: PdfDict): Promise<PdfFont> {
  const encV = doc.resolve(fd.get("Encoding") ?? null);
  let encCMap: CMap | null = null;
  let encName = "";
  if (encV instanceof PdfName) encName = encV.name;
  else if (encV instanceof PdfStream) {
    try {
      const d = await doc.streamBytes(encV);
      if (d) encCMap = parseCMap(d);
    } catch {
      /* use the default two-byte codes */
    }
  }
  const tu = await toUnicodeOf(doc, fd);
  const descs = doc.arrayOf(fd.get("DescendantFonts") ?? null);
  const df = descs && descs.length > 0 ? doc.dictOf(descs[0]) : null;
  const dw = df ? (doc.numOf(df.get("DW") ?? null) ?? 1000) : 1000;
  const wmap = new Map<number, number>();
  const wArr = df ? doc.arrayOf(df.get("W") ?? null) : null;
  if (wArr) {
    for (let i = 0; i < wArr.length; ) {
      const c = doc.numOf(wArr[i] ?? null);
      const nxt = doc.resolve(wArr[i + 1] ?? null);
      if (c === null) {
        i++;
        continue;
      }
      if (Array.isArray(nxt)) {
        nxt.forEach((w, k) => {
          const wv = doc.numOf(w);
          if (wv !== null && wmap.size < 70000) wmap.set(c + k, wv);
        });
        i += 2;
      } else if (typeof nxt === "number") {
        const w = doc.numOf(wArr[i + 2] ?? null);
        if (w !== null) for (let cc = c; cc <= Math.min(nxt, c + MAX_RANGE) && wmap.size < 70000; cc++) wmap.set(cc, w);
        i += 3;
      } else i++;
    }
  }
  const codespaces = encCMap && encCMap.codespaces.length > 0 ? encCMap.codespaces : tu && tu.codespaces.length > 0 && !encName ? tu.codespaces : [{ bytes: 2, lo: 0, hi: 0xffff }];
  const lengths = [...new Set(codespaces.map((c) => c.bytes))].sort((a, b) => a - b);
  const codeIsUnicode = /UCS2|UTF16/i.test(encName);
  const cidOf = (code: number): number => {
    if (!encCMap) return code;
    const direct = encCMap.cids.get(code);
    if (direct !== undefined) return direct;
    for (const r of encCMap.cidRanges) if (code >= r.lo && code <= r.hi) return r.cid + (code - r.lo);
    return code;
  };
  return {
    decode(s: Uint8Array): Decoded {
      let text = "";
      let width = 0;
      let glyphs = 0;
      let spaces = 0;
      let unmapped = 0;
      for (let i = 0; i < s.length; ) {
        let len = lengths[0];
        let code = 0;
        let found = false;
        for (const L of lengths) {
          if (i + L > s.length) break;
          let v = 0;
          for (let k = 0; k < L; k++) v = v * 256 + s[i + k];
          if (codespaces.some((c) => c.bytes === L && v >= c.lo && v <= c.hi)) {
            len = L;
            code = v;
            found = true;
            break;
          }
        }
        if (!found) {
          len = Math.min(lengths[0], s.length - i);
          code = 0;
          for (let k = 0; k < len; k++) code = code * 256 + s[i + k];
        }
        i += len;
        glyphs++;
        const mapped = tu ? tu.bf.get(code) : undefined;
        if (mapped !== undefined) text += mapped;
        else if (codeIsUnicode && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) text += String.fromCodePoint(code);
        else unmapped++;
        width += wmap.get(cidOf(code)) ?? dw;
        if (len === 1 && code === 32) spaces++;
      }
      return { text, width, glyphs, spaces, unmapped };
    },
  };
}

/** Builds the decoder for one font dictionary. Never throws: a font that can't be read decodes to nothing. */
export async function loadFont(doc: PdfDoc, fontObj: PdfValue): Promise<PdfFont> {
  const fd = doc.dictOf(fontObj);
  if (!fd) return { decode: () => EMPTY };
  const subtype = doc.nameOf(fd.get("Subtype") ?? null) ?? "Type1";
  try {
    if (subtype === "Type0") return await loadType0(doc, fd);
    return await loadSimple(doc, fd, subtype);
  } catch {
    return { decode: () => EMPTY };
  }
}

