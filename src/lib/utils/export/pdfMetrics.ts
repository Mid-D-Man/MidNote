// Helvetica / Helvetica-Bold glyph widths for the PDF exporter (round 30).
//
// WHY A TABLE AND NOT A MEASURING CALL: the PDF standard fonts are
// referenced by name and drawn by the *viewer*, so wrapping has to use the
// font's real advance widths. Canvas measureText() would measure the
// phone's own fallback font (Roboto), which is NOT metric-compatible with
// Helvetica — lines would wrap wrong and text would run off the page.
//
// WHERE THE NUMBERS CAME FROM: the Adobe core-14 AFM metrics as shipped in
// @pdf-lib/standard-fonts, read ONCE at development time through that
// package's WinAnsi encoding (npm-installed in a scratch folder, not added
// to this project — no runtime dependency). Verified: A=667, space=278,
// i=222, bold A=722. Oblique faces share their upright face's widths
// exactly (checked), so only two tables are needed. Units are 1/1000 em.
//
// Index = WinAnsi (Windows-1252) code - 32, for codes 32..255. Codes with
// no WinAnsi glyph (127, 129, 141, 143, 144, 157) are never emitted (see
// toWinAnsi below) and hold 0.

export const FIRST_CODE = 32;

export const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 500,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

export const HELVETICA_BOLD_WIDTHS: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 556,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

// Windows-1252 0x80..0x9F, the only range where WinAnsi differs from
// Unicode/Latin-1 code-for-code. Everything else in 32..126 and 160..255
// is identity. Keys are Unicode code points, values are WinAnsi bytes.
const HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// Letters the standard fonts lack that have an obvious plain-Latin stand-in
// and that Unicode can't decompose into base + accent (the Hausa hooked
// letters, the open vowels Yoruba/Igbo use, a few typographic look-alikes).
// Written as an explicit table rather than guessed at.
const LATIN_FALLBACK: Record<string, string> = {
  "\u0253": "b", "\u0181": "B", "\u0257": "d", "\u018a": "D", "\u0199": "k", "\u0198": "K",
  "\u01b4": "y", "\u01b3": "Y", "\u014b": "n", "\u014a": "N", "\u025b": "e", "\u0190": "E",
  "\u0254": "o", "\u0186": "O", "\u0131": "i", "\u0142": "l", "\u0141": "L", "\u0111": "d",
  "\u0110": "D", "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2212": "-", "\u2192": "->",
  "\u2190": "<-", "\u2194": "<->", "\u21d2": "=>", "\u2264": "<=", "\u2265": ">=", "\u2260": "!=",
  "\u2713": "v", "\u2714": "v", "\u2610": "[ ]", "\u2611": "[x]", "\u2612": "[x]",
};

function directByte(cp: number): number | undefined {
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 0xa1 && cp <= 0xff) return cp;
  return HIGH[cp];
}

/**
 * What to draw for a character the standard fonts cannot: the table above,
 * else the letter without its accent (NFD, combining marks dropped — so
 * Yoruba "ẹ" / "ọ́" / "ṣ" and Igbo "ị" / "ụ" come out as e / o / s / i / u
 * rather than "?"), else nothing usable (null).
 */
function latinFallback(ch: string): number[] | null {
  const mapped = LATIN_FALLBACK[ch];
  const candidate =
    mapped ?? ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!candidate || candidate === ch) return null;
  const bytes: number[] = [];
  for (const c of candidate) {
    const b = directByte(c.codePointAt(0) as number);
    if (b === undefined) return null;
    bytes.push(b);
  }
  return bytes;
}

/**
 * Text -> WinAnsi bytes. Characters WinAnsi has are kept as they are.
 * Accented Latin letters it lacks lose the accent instead of turning into
 * "?" (see latinFallback). Anything else the standard fonts cannot draw —
 * emoji, non-Latin scripts, box-drawing — becomes a single "?" per code
 * point (one "?" for an emoji, not two for its surrogate pair). Combining
 * marks on their own, zero-width joiners and variation selectors vanish.
 * Non-breaking spaces and the typographic space family become a plain
 * space; tabs become four spaces. This limit is inherent to PDF's built-in
 * fonts (any PDF library has it unless a font is embedded) and is the one
 * real trade-off of the no-dependency PDF writer; DOCX and TXT are full
 * Unicode.
 */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x09) { out.push(32, 32, 32, 32); continue; }
    if (cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000) { out.push(32); continue; }
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    if (cp >= 0x300 && cp <= 0x36f) continue; // a combining mark with no base to sit on
    const direct = directByte(cp);
    if (direct !== undefined) { out.push(direct); continue; }
    const fb = latinFallback(ch);
    if (fb) out.push(...fb);
    else out.push(0x3f);
  }
  return out;
}

export function glyphWidth(bold: boolean, code: number): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const i = code - FIRST_CODE;
  return i >= 0 && i < table.length ? table[i] : 0;
}

/** Width in points of already-encoded WinAnsi bytes at a font size. */
export function bytesWidth(bytes: readonly number[], bold: boolean, size: number): number {
  let sum = 0;
  for (const b of bytes) sum += glyphWidth(bold, b);
  return (sum * size) / 1000;
}
