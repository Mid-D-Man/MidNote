// Round K — the text of a Word document (.docx), with no new package.
//
// A .docx is a ZIP file; the words are in its word/document.xml. This reads the ZIP's directory, pulls out that one
// entry, inflates it with the browser's own DecompressionStream, and collects the <w:t> text of each paragraph.
//
// DATA ONLY. Nothing in the document is run or opened: macros (vbaProject.bin), embedded objects, images, links and
// fields are never touched, only the text is read. Deleted text from tracked changes (<w:delText>) is left out.
//
// SAFE AGAINST A MALICIOUS FILE
//   - every offset and length read from the ZIP is bounds-checked against the file; anything odd gives null
//   - only ONE entry is ever read, by exact name
//   - the inflated size is capped (a zip bomb stops at MAX_XML_BYTES and fails), whatever the header claims
//   - ZIP64 and encrypted entries are refused
// Throws DocxError for "this needs a newer WebView" / "too large"; returns null for "not a Word document".

export const MAX_XML_BYTES = 20 * 1024 * 1024;

export class DocxError extends Error {
  constructor(public kind: "unsupported" | "too-large" | "bad-data", message: string) {
    super(message);
  }
}

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);

interface Entry {
  method: number;
  flags: number;
  compSize: number;
  localOffset: number;
}

function findEntry(b: Uint8Array, wanted: string): Entry | null {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // End of central directory record: 22 bytes + comment (up to 65535), searched backwards
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
    const name = new TextDecoder("utf-8").decode(b.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) return { method, flags, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => { writable: WritableStream; readable: ReadableStream } }).DecompressionStream;
  if (!DS) throw new DocxError("unsupported", "This phone's browser engine can't unpack Word documents yet. Update Android System WebView and try again.");
  const ds = new DS("deflate-raw");
  const writer = ds.writable.getWriter();
  // write in the background; a failed or stopped stream surfaces through the reader below
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
        throw new DocxError("too-large", "That document is too large to open.");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof DocxError) throw e;
    throw new DocxError("bad-data", "That Word document is damaged.");
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** word/document.xml of a .docx as text; null when the bytes are not a Word document. */
export async function readDocumentXml(b: Uint8Array): Promise<string | null> {
  const entry = findEntry(b, "word/document.xml");
  if (!entry) return null;
  if (entry.flags & 1) return null; // encrypted
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const lo = entry.localOffset;
  if (lo + 30 > b.length || u32(d, lo) !== 0x04034b50) return null;
  const start = lo + 30 + u16(d, lo + 26) + u16(d, lo + 28);
  const end = start + entry.compSize;
  if (end > b.length || end < start) return null;
  const raw = b.subarray(start, end);
  let xml: Uint8Array;
  if (entry.method === 0) {
    if (raw.length > MAX_XML_BYTES) throw new DocxError("too-large", "That document is too large to open.");
    xml = raw;
  } else if (entry.method === 8) {
    xml = await inflateRaw(raw, MAX_XML_BYTES);
  } else {
    return null;
  }
  return new TextDecoder("utf-8").decode(xml);
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-fA-F]{1,6})|#(\d{1,7})|(amp|lt|gt|quot|apos));/g, (_, hex: string, dec: string, name: string) => {
    if (name) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name]!;
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0) return "";
    return String.fromCodePoint(cp);
  });
}

/** The visible text of a word/document.xml: one line per paragraph; tabs and line breaks kept. */
export function documentXmlToText(xml: string): string {
  // Word writes a text box twice (the modern form and a fallback copy for old readers): keep one
  // An empty paragraph can be written self-closing (<w:p/>): turn it into <w:p></w:p> so it still counts as a (blank) line
  const paragraphs = xml
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "")
    .replace(/<w:p(?:\s[^>]*)?\/>/g, "<w:p></w:p>")
    .split("</w:p>");
  const lines: string[] = [];
  // the last piece is whatever follows the final paragraph (section settings): not text
  for (let i = 0; i < paragraphs.length - 1; i++) {
    let line = "";
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>|<w:noBreakHyphen\s*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(paragraphs[i])) !== null) {
      if (m[1] !== undefined) line += decodeEntities(m[1]);
      else if (m[0].startsWith("<w:tab")) line += "\t";
      else if (m[0].startsWith("<w:noBreak")) line += "-";
      else line += "\n";
    }
    lines.push(line);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/** The text of a Word document, or null when it isn't one. */
export async function docxToText(bytes: Uint8Array): Promise<string | null> {
  const xml = await readDocumentXml(bytes);
  if (xml === null) return null;
  return documentXmlToText(xml);
}
