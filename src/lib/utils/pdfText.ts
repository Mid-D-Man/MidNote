// The text of a PDF, with no new package.
//
// A PDF is a set of numbered objects; its pages are listed in a tree, and each page has a content stream that says what to draw,
// including every piece of text and where it goes (see pdfObjects.ts, pdfContent.ts, pdfFonts.ts, pdfLayout.ts). This reads that
// text back out, page by page, as plain text (with "Page N" above each page when there are several).
//
// WHAT COMES OUT: the text, in reading order for ordinary documents, with paragraphs joined and tables as rows with tabs between
// columns; and the JPEG pictures on each page (a scan is usually one JPEG per page), which the Reading view shows under the page's
// text. WHAT DOES NOT: drawings and charts, pictures in other packings (JPEG 2000, fax, CMYK), and the text of a SCANNED PDF
// (pages that are pictures of text) unless an OCR layer was added when it was scanned: MidNote does not do OCR. Encrypted files are refused. Right-to-left and
// complex scripts come out in the order the file draws them, which may not read correctly.
//
// DATA ONLY. Nothing in the file is run or opened: JavaScript, links, actions, forms and embedded files are never touched. All reads
// are bounded (stream size, nesting, pages, output length).
import { PdfDoc, PdfRef, PdfStream, type PdfValue } from "$lib/utils/pdfObjects";
import { PdfError } from "$lib/utils/pdfFilters";
import { FontCache, interpretContent, type PictureSink, type Run } from "$lib/utils/pdfContent";
import { runsToText } from "$lib/utils/pdfLayout";
import { Collector, MAX_DOC_IMAGES, type DocImage } from "$lib/utils/docImages";

export { PdfError };

export const MAX_PDF_PAGES = 3000;
const MAX_PAGE_CONTENT = 48 * 1024 * 1024;

export interface PdfTextResult {
  text: string;
  /** Pages in the file, and how many were read before the text limit was reached. */
  pages: number;
  pagesRead: number;
  /** Stopped early because the text reached the limit. */
  truncated: boolean;
  /** Most of the characters had no text we could find (a font MidNote can't decode): what came out is mostly missing. */
  garbled: boolean;
  /** The JPEG pictures, each on the page it is drawn on (`at` is the page number, as in "Page N"). */
  pictures: DocImage[];
  /** There is no text at all but there are pictures: a scan. The text then only holds the "Page N" lines the pictures hang on. */
  scanned: boolean;
}

async function pageContent(doc: PdfDoc, page: Map<string, PdfValue>): Promise<Uint8Array | null> {
  const c = doc.resolve(page.get("Contents") ?? null);
  const parts: PdfValue[] = Array.isArray(c) ? c : [c];
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const p of parts) {
    const ref = p instanceof PdfRef || p instanceof PdfStream ? p : null;
    if (!ref) continue;
    const bytes = await doc.streamBytes(ref);
    if (!bytes) continue;
    total += bytes.length + 1;
    if (total > MAX_PAGE_CONTENT) throw new PdfError("too-large", "That PDF is too large to open.");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let o = 0;
  for (const ch of chunks) {
    out.set(ch, o);
    o += ch.length;
    out[o++] = 0x0a;
  }
  return out;
}

/** The text of a PDF, or null when the bytes aren't one. Throws PdfError for an encrypted, damaged or too-large file. */
export async function pdfToText(bytes: Uint8Array, maxChars = 400_000): Promise<PdfTextResult | null> {
  const doc = await PdfDoc.open(bytes);
  if (!doc) return null;
  const pages = doc.pages(MAX_PDF_PAGES);
  const fonts = new FontCache(doc);
  const texts: { n: number; text: string }[] = [];
  const found = new Collector();
  const sink: PictureSink = { streams: [], seen: new Set<number>(), max: MAX_DOC_IMAGES * 2 };
  let chars = 0;
  let codes = 0;
  let unmapped = 0;
  let pagesRead = 0;
  let truncated = false;
  for (let i = 0; i < pages.length; i++) {
    if (chars >= maxChars) {
      truncated = true;
      break;
    }
    pagesRead = i + 1;
    if (i % 20 === 19) await new Promise<void>((r) => setTimeout(r, 0)); // let the screen breathe on a long document
    let content: Uint8Array | null = null;
    try {
      content = await pageContent(doc, pages[i].page);
    } catch (e) {
      if (e instanceof PdfError && e.kind === "too-large") throw e;
      continue; // a damaged page is skipped, the others are still read
    }
    if (!content) continue;
    const runs: Run[] = [];
    sink.streams = [];
    try {
      await interpretContent(content, pages[i].resources, { doc, fonts, out: runs, pictures: found.full ? undefined : sink });
    } catch (e) {
      if (e instanceof PdfError && e.kind === "too-large") throw e;
    }
    for (const r of runs) {
      codes += r.codes;
      unmapped += r.unmapped;
    }
    let pictured = false;
    for (const stream of sink.streams) {
      if (found.full) break;
      try {
        const jpeg = await doc.streamBytes(stream, true);
        if (jpeg && found.add(jpeg, "page", i + 1)) pictured = true;
      } catch (e) {
        if (e instanceof PdfError && e.kind === "too-large") throw e; // (one damaged picture is skipped)
      }
    }
    const text = runsToText(runs).trim();
    if (text !== "" || pictured) {
      texts.push({ n: i + 1, text });
      chars += text.length;
    }
  }
  // with pictures, every page that has text or a picture keeps its "Page N" line (even a single page): the pictures hang on it
  const marked = texts.length > 1 || found.out.length > 0;
  const body = texts.length === 0 ? "" : marked ? texts.map((t) => `Page ${t.n}${t.text === "" ? "" : `\n${t.text}`}`).join("\n\n") : texts[0].text;
  const scanned = found.out.length > 0 && texts.every((t) => t.text === "");
  return { text: body.replace(/\n{3,}/g, "\n\n"), pages: pages.length, pagesRead, truncated, garbled: codes >= 20 && unmapped / codes > 0.6, pictures: found.out, scanned };
}
