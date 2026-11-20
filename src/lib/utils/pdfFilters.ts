// PDF stream filters: how the bytes of a PDF stream are packed, and how to unpack them. Part of the PDF text reader (pdfText.ts);
// no new package. Flate uses the browser's own DecompressionStream; the rest are small and written here.
//
// Everything is bounded: a stream that unpacks to more than `cap` bytes stops there (a bomb fails instead of eating the phone's
// memory), and every decoder always moves forward through its input.

export class PdfError extends Error {
  constructor(
    public kind: "unsupported" | "encrypted" | "too-large" | "bad-data",
    message: string,
  ) {
    super(message);
  }
}

/** Most bytes one stream may unpack to. */
export const MAX_STREAM_BYTES = 64 * 1024 * 1024;

type DS = new (f: string) => { writable: WritableStream; readable: ReadableStream };

/**
 * zlib ("FlateDecode"). Damaged or cut-off data is common in the wild and the part that did unpack is still useful, so on an error
 * what was produced SO FAR is returned (an error before any output throws bad-data).
 */
export async function inflateZlib(data: Uint8Array, cap: number = MAX_STREAM_BYTES): Promise<Uint8Array> {
  const Ctor = (globalThis as { DecompressionStream?: DS }).DecompressionStream;
  if (!Ctor) throw new PdfError("unsupported", "This phone can't open PDF files yet. Update Android System WebView and try again.");
  const ds = new Ctor("deflate");
  const writer = ds.writable.getWriter();
  void writer.write(data as unknown as BufferSource).then(() => writer.close()).catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let failed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        void reader.cancel().catch(() => {});
        throw new PdfError("too-large", "That PDF is too large to open.");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof PdfError) throw e;
    failed = true;
  }
  if (failed && total === 0) throw new PdfError("bad-data", "That PDF is damaged.");
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

export function asciiHexDecode(d: Uint8Array): Uint8Array {
  const out: number[] = [];
  let hi = -1;
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if (c === 0x3e) break; // >
    let v: number;
    if (c >= 0x30 && c <= 0x39) v = c - 0x30;
    else if (c >= 0x41 && c <= 0x46) v = c - 0x41 + 10;
    else if (c >= 0x61 && c <= 0x66) v = c - 0x61 + 10;
    else continue; // whitespace and anything else is skipped
    if (hi < 0) hi = v;
    else {
      out.push((hi << 4) | v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi << 4);
  return Uint8Array.from(out);
}

export function ascii85Decode(d: Uint8Array): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  let i = 0;
  if (d.length >= 2 && d[0] === 0x3c && d[1] === 0x7e) i = 2; // optional <~
  const flush = (n: number) => {
    // n = how many input characters the group had (2..5); pad with 'u' (84) and keep n-1 bytes
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + (k < n ? group[k] : 84);
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    for (let k = 0; k < n - 1; k++) out.push(bytes[k]);
  };
  for (; i < d.length; i++) {
    const c = d[i];
    if (c === 0x7e) break; // ~ (of ~>)
    if (isWs(c)) continue;
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0); // z = four zero bytes
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    group.push(c - 0x21);
    if (group.length === 5) {
      flush(5);
      group.length = 0;
    }
  }
  if (group.length >= 2) flush(group.length);
  return Uint8Array.from(out);
}

export function runLengthDecode(d: Uint8Array, cap: number = MAX_STREAM_BYTES): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < d.length) {
    const n = d[i++];
    if (n === 128) break;
    if (n < 128) {
      for (let k = 0; k <= n && i < d.length; k++) out.push(d[i++]);
    } else {
      const v = d[i++];
      if (v === undefined) break;
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
    if (out.length > cap) throw new PdfError("too-large", "That PDF is too large to open.");
  }
  return Uint8Array.from(out);
}

/** LZW as PDF uses it (MSB first, codes 9..12 bits; EarlyChange 1 by default). */
export function lzwDecode(d: Uint8Array, earlyChange = 1, cap: number = MAX_STREAM_BYTES): Uint8Array {
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i++) table.push([i]);
    table.push([], []); // 256 = clear, 257 = end of data
  };
  reset();
  let bits = 9;
  let buf = 0;
  let nbuf = 0;
  let prev: number[] | null = null;
  let pos = 0;
  for (;;) {
    while (nbuf < bits && pos < d.length) {
      buf = (buf << 8) | d[pos++];
      nbuf += 8;
    }
    if (nbuf < bits) break;
    const code = (buf >>> (nbuf - bits)) & ((1 << bits) - 1);
    nbuf -= bits;
    buf &= (1 << nbuf) - 1;
    if (code === 256) {
      reset();
      bits = 9;
      prev = null;
      continue;
    }
    if (code === 257) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev !== null && code === table.length) entry = prev.concat(prev[0]);
    else break; // not valid LZW: stop with what there is
    for (const b of entry) out.push(b);
    if (out.length > cap) throw new PdfError("too-large", "That PDF is too large to open.");
    if (prev !== null && table.length < 4096) table.push(prev.concat(entry[0]));
    prev = entry;
    const n = table.length + earlyChange;
    bits = n >= 2048 ? 12 : n >= 1024 ? 11 : n >= 512 ? 10 : 9;
  }
  return Uint8Array.from(out);
}

/** PNG predictors (10..15) and TIFF predictor 2 (8-bit), as used after Flate/LZW in object streams and some content streams. */
export function applyPredictor(d: Uint8Array, predictor: number, colors: number, bpc: number, columns: number): Uint8Array {
  if (predictor < 2) return d;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  if (!(rowBytes > 0) || rowBytes > 1 << 24) return d;
  if (predictor === 2) {
    if (bpc !== 8) return d;
    const out = d.slice();
    for (let r = 0; r + rowBytes <= out.length; r += rowBytes) {
      for (let i = bpp; i < rowBytes; i++) out[r + i] = (out[r + i] + out[r + i - bpp]) & 0xff;
    }
    return out;
  }
  if (predictor < 10) return d;
  const stride = rowBytes + 1;
  const rows = Math.floor(d.length / stride);
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const ft = d[r * stride];
    const src = r * stride + 1;
    const dst = r * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = d[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[dst - rowBytes + i] : 0;
      const c = r > 0 && i >= bpp ? out[dst - rowBytes + i - bpp] : 0;
      let v: number;
      switch (ft) {
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = x;
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}
