// A page's CONTENT STREAM is a small program of drawing commands. This runs only the part that matters for reading: where text is
// put on the page ("show this string with this font at this position"), keeping track of the position, the font and the scaling
// that the other commands set up, and follows form XObjects (reusable drawing blocks that some producers put the whole page in).
// What comes out is a list of positioned runs of text, for pdfText.ts to put into lines. Part of the PDF text reader; no new package.
//
// DATA ONLY: the commands are only READ to track a position; nothing is drawn, no action or script is run. Bounded: operand stack
// size, form nesting depth, runs per page, tokens per stream.
import { Lexer, PdfName, PdfRef, PdfStream, parseFrom, type PdfDict, type PdfDoc, type PdfValue } from "$lib/utils/pdfObjects";
import { loadFont, type PdfFont } from "$lib/utils/pdfFonts";
import { PdfError } from "$lib/utils/pdfFilters";

export interface Run {
  text: string;
  /** Where it starts, and the x where it ends, on the page (PDF units; y grows upward). */
  x: number;
  y: number;
  endX: number;
  /** Font size as drawn. */
  size: number;
  /** Character codes in the run, and how many had no text we could find. */
  codes: number;
  unmapped: number;
}

type M = [number, number, number, number, number, number];
const IDENT: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

interface GState {
  ctm: M;
  tc: number;
  tw: number;
  tz: number;
  tl: number;
  fs: number;
  font: PdfFont | null;
}

export class FontCache {
  private byNum = new Map<number, PdfFont>();
  private byDict = new Map<PdfDict, PdfFont>();
  constructor(private doc: PdfDoc) {}
  async get(v: PdfValue): Promise<PdfFont> {
    if (v instanceof PdfRef) {
      const hit = this.byNum.get(v.num);
      if (hit) return hit;
      const f = await loadFont(this.doc, v);
      this.byNum.set(v.num, f);
      return f;
    }
    const d = this.doc.dictOf(v);
    if (d) {
      const hit = this.byDict.get(d);
      if (hit) return hit;
      const f = await loadFont(this.doc, v);
      this.byDict.set(d, f);
      return f;
    }
    return loadFont(this.doc, v);
  }
}

const MAX_OPERANDS = 4096;
const MAX_RUNS = 400_000;
const MAX_DEPTH = 8;
/** A TJ adjustment (thousandths of the font size) beyond which the gap is a word space, not kerning. */
const TJ_SPACE = 150;

/** Where the pictures a page draws are noted (each picture object once for the whole document). */
export interface PictureSink {
  streams: PdfStream[];
  /** Object numbers already noted (on this page or an earlier one): a logo on every page is kept once. */
  seen: Set<number>;
  max: number;
}

export interface InterpretOptions {
  doc: PdfDoc;
  fonts: FontCache;
  out: Run[];
  depth?: number;
  visited?: Set<number>;
  pictures?: PictureSink;
}

const num = (v: PdfValue | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function interpretContent(data: Uint8Array, resources: PdfValue, o: InterpretOptions, initial?: GState): Promise<void> {
  const { doc, fonts, out } = o;
  const depth = o.depth ?? 0;
  const visited = o.visited ?? new Set<number>();
  const res = doc.dictOf(resources);
  const fontDict = res ? doc.dictOf(res.get("Font") ?? null) : null;
  const xobjDict = res ? doc.dictOf(res.get("XObject") ?? null) : null;

  let gs: GState = initial ? { ...initial } : { ctm: IDENT, tc: 0, tw: 0, tz: 1, tl: 0, fs: 0, font: null };
  const stack: GState[] = [];
  let tm: M = IDENT;
  let tlm: M = IDENT;
  let ops: PdfValue[] = [];
  const lx = new Lexer(data);

  const origin = (): { x: number; y: number } => ({ x: tm[4] * gs.ctm[0] + tm[5] * gs.ctm[2] + gs.ctm[4], y: tm[4] * gs.ctm[1] + tm[5] * gs.ctm[3] + gs.ctm[5] });
  const shift = (tx: number) => {
    tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + tx * tm[0], tm[5] + tx * tm[1]];
  };
  const nextLine = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };
  const sizeNow = (): number => {
    const sy = Math.hypot(tm[2], tm[3]) * Math.hypot(gs.ctm[2], gs.ctm[3]);
    const sx = Math.hypot(tm[0], tm[1]) * Math.hypot(gs.ctm[0], gs.ctm[1]);
    return gs.fs * (sy > 1e-6 ? sy : sx);
  };

  // one Tj / TJ / ' / " : the parts are strings (shown) and numbers (adjustments), made into ONE run
  const show = (parts: PdfValue[]) => {
    if (!gs.font || out.length >= MAX_RUNS) return;
    const start = origin();
    const size = sizeNow();
    let text = "";
    let codes = 0;
    let unmapped = 0;
    for (const part of parts) {
      if (part instanceof Uint8Array) {
        const d = gs.font.decode(part);
        text += d.text;
        codes += d.glyphs;
        unmapped += d.unmapped;
        shift(((d.width / 1000) * gs.fs + gs.tc * d.glyphs + gs.tw * d.spaces) * gs.tz);
      } else if (typeof part === "number" && Number.isFinite(part)) {
        shift((-part / 1000) * gs.fs * gs.tz);
        if (-part > TJ_SPACE && text !== "" && !text.endsWith(" ")) text += " ";
      }
    }
    if (codes === 0) return;
    out.push({ text, x: start.x, y: start.y, endX: origin().x, size: Math.abs(size), codes, unmapped });
  };

  for (let guard = 0; guard < 20_000_000; guard++) {
    const t = lx.next();
    if (t.t === "eof") break;
    if (t.t === "kw" && t.v !== "true" && t.v !== "false" && t.v !== "null") {
      const op = t.v;
      switch (op) {
        case "q": stack.push({ ...gs }); if (stack.length > 256) stack.shift(); break;
        case "Q": { const p = stack.pop(); if (p) gs = p; break; }
        case "cm": if (ops.length >= 6) gs.ctm = mul([num(ops[0]), num(ops[1]), num(ops[2]), num(ops[3]), num(ops[4]), num(ops[5])], gs.ctm); break;
        case "BT": tm = IDENT; tlm = IDENT; break;
        case "Tf": {
          const fname = ops[0];
          gs.fs = num(ops[1]);
          const ref = fontDict && fname instanceof PdfName ? (fontDict.get(fname.name) ?? null) : null;
          gs.font = ref === null ? null : await fonts.get(ref);
          break;
        }
        case "Tc": gs.tc = num(ops[0]); break;
        case "Tw": gs.tw = num(ops[0]); break;
        case "Tz": gs.tz = num(ops[0]) / 100; break;
        case "TL": gs.tl = num(ops[0]); break;
        case "Td": nextLine(num(ops[0]), num(ops[1])); break;
        case "TD": gs.tl = -num(ops[1]); nextLine(num(ops[0]), num(ops[1])); break;
        case "Tm": if (ops.length >= 6) { tm = [num(ops[0]), num(ops[1]), num(ops[2]), num(ops[3]), num(ops[4]), num(ops[5])]; tlm = tm; } break;
        case "T*": nextLine(0, -gs.tl); break;
        case "Tj": show([ops[0] ?? null]); break;
        case "'": nextLine(0, -gs.tl); show([ops[0] ?? null]); break;
        case '"': gs.tw = num(ops[0]); gs.tc = num(ops[1]); nextLine(0, -gs.tl); show([ops[2] ?? null]); break;
        case "TJ": { const arr = ops[0]; if (Array.isArray(arr)) show(arr); break; }
        case "Do": {
          const nm = ops[0];
          if (depth >= MAX_DEPTH || !xobjDict || !(nm instanceof PdfName)) break;
          const ref = xobjDict.get(nm.name) ?? null;
          const id = ref instanceof PdfRef ? ref.num : -1;
          if (id >= 0 && visited.has(id)) break;
          const xo = doc.resolve(ref);
          if (xo instanceof PdfStream && doc.nameOf(xo.dict.get("Subtype") ?? null) === "Image") {
            const pics = o.pictures;
            // a picture is noted once; a stencil mask and a CMYK picture (its colours come out wrong in a browser) are not pictures to show
            if (pics && pics.streams.length < pics.max && !(id >= 0 && pics.seen.has(id)) && xo.dict.get("ImageMask") !== true && doc.nameOf(xo.dict.get("ColorSpace") ?? null) !== "DeviceCMYK") {
              if (id >= 0) pics.seen.add(id);
              pics.streams.push(xo);
            }
            break;
          }
          if (!(xo instanceof PdfStream) || doc.nameOf(xo.dict.get("Subtype") ?? null) !== "Form") break;
          if (id >= 0) visited.add(id);
          try {
            const body = await doc.streamBytes(xo);
            if (body) {
              const mat = doc.arrayOf(xo.dict.get("Matrix") ?? null);
              const fm: M = mat && mat.length >= 6 ? [num(mat[0]), num(mat[1]), num(mat[2]), num(mat[3]), num(mat[4]), num(mat[5])] : IDENT;
              const inner = xo.dict.get("Resources");
              await interpretContent(body, inner !== undefined ? inner : resources, { doc, fonts, out, depth: depth + 1, visited, pictures: o.pictures }, { ...gs, ctm: mul(fm, gs.ctm) });
            }
          } catch (e) {
            // a form whose stream is damaged is skipped: the rest of the page is still read (only "too large" stops everything)
            if (e instanceof PdfError && e.kind === "too-large") throw e;
          } finally {
            if (id >= 0) visited.delete(id);
          }
          break;
        }
        case "BI": {
          // inline image: skip its dictionary, then its raw bytes up to "EI"
          for (let k = 0; k < 200; k++) {
            const x = lx.next();
            if (x.t === "eof" || (x.t === "kw" && x.v === "ID")) break;
          }
          let p = lx.pos + 1;
          const b = data;
          for (; p + 2 < b.length; p++) {
            if (b[p] === 0x45 && b[p + 1] === 0x49 && (p === 0 || b[p - 1] === 0x20 || b[p - 1] === 0x0a || b[p - 1] === 0x0d || b[p - 1] === 0x09) && (p + 2 >= b.length || b[p + 2] === 0x20 || b[p + 2] === 0x0a || b[p + 2] === 0x0d || b[p + 2] === 0x09)) break;
          }
          lx.pos = Math.min(b.length, p + 2);
          break;
        }
        default: break;
      }
      ops = [];
      continue;
    }
    try {
      ops.push(parseFrom(lx, t, false));
    } catch {
      ops = [];
    }
    if (ops.length > MAX_OPERANDS) ops = [];
  }
}
