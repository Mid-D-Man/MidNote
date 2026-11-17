// Reading the entries of a ZIP file (what .pptx is, like .docx), with no new package. Shared by pptxText.ts; docxText.ts has its own
// copy of the same idea for the one Word entry.
//
// DATA ONLY and SAFE AGAINST A MALICIOUS FILE
//   - every offset and length read from the ZIP is bounds-checked against the file; anything odd gives null
//   - an entry is read by exact name and inflated with the browser's own DecompressionStream; the inflated size is capped (a zip
//     bomb stops at the cap and fails), whatever the header claims, and the TOTAL read from one file is capped by the caller
//   - ZIP64 and encrypted entries are refused
// Throws ZipError for "this needs a newer WebView" / "too large"; returns null for "not a ZIP we can read".

export class ZipError extends Error {
  constructor(public kind: "unsupported" | "too-large" | "bad-data", message: string) {
    super(message);
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compSize: number;
  localOffset: number;
}

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);

/** The central directory of a ZIP: every entry's name and where it is. Null when this isn't a ZIP, or is ZIP64 or damaged. */
export function listZip(b: Uint8Array): Map<string, ZipEntry> | null {
  if (b.length < 22) return null;
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(d, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(d, eocd + 10);
  const cdSize = u32(d, eocd + 12);
  const cdOffset = u32(d, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // ZIP64
  if (cdOffset + cdSize > b.length) return null;
  const entries = new Map<string, ZipEntry>();
  const utf8 = new TextDecoder("utf-8");
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(d, p) !== 0x02014b50) return null;
    const flags = u16(d, p + 8);
    const method = u16(d, p + 10);
    const compSize = u32(d, p + 20);
    const nameLen = u16(d, p + 28);
    const extraLen = u16(d, p + 30);
    const commentLen = u16(d, p + 32);
    const localOffset = u32(d, p + 42);
    if (p + 46 + nameLen > b.length) return null;
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (!entries.has(name)) entries.set(name, { name, method, flags, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => { writable: WritableStream; readable: ReadableStream } }).DecompressionStream;
  if (!DS) throw new ZipError("unsupported", "This phone's browser engine can't unpack documents yet. Update Android System WebView and try again.");
  const ds = new DS("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(data as unknown as BufferSource).then(() => writer.close()).catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        void reader.cancel().catch(() => {});
        throw new ZipError("too-large", "That document is too large to open.");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError("bad-data", "That document is damaged.");
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** One entry's bytes, inflated (at most `cap` of them). Null for an encrypted or oddly packed entry or one whose offsets don't fit the file. */
export async function readZipEntry(b: Uint8Array, entry: ZipEntry, cap: number): Promise<Uint8Array | null> {
  if (entry.flags & 1) return null; // encrypted
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const lo = entry.localOffset;
  if (lo + 30 > b.length || u32(d, lo) !== 0x04034b50) return null;
  const start = lo + 30 + u16(d, lo + 26) + u16(d, lo + 28);
  const end = start + entry.compSize;
  if (end > b.length || end < start) return null;
  const raw = b.subarray(start, end);
  if (entry.method === 0) {
    if (raw.length > cap) throw new ZipError("too-large", "That document is too large to open.");
    return raw;
  }
  if (entry.method === 8) return inflateRaw(raw, cap);
  return null;
}

/** One entry as UTF-8 text; null as readZipEntry. */
export async function readZipText(b: Uint8Array, entry: ZipEntry, cap: number): Promise<string | null> {
  const bytes = await readZipEntry(b, entry, cap);
  return bytes === null ? null : new TextDecoder("utf-8").decode(bytes);
}
