// Pictures in a PowerPoint or Word file opened with "Open with", and where they sit. The text of the file becomes the note (utils/
// pptxText.ts, docxText.ts, pdfText.ts); the pictures are kept next to it on this phone (utils/docImageStore.ts) and drawn in
// place by the PowerPoint / PDF / Word views of the Reading view (utils/readingDocs.ts). PDF pictures are collected by pdfText.ts.
//
// Only ordinary raster pictures are taken: PNG, JPEG, GIF, WebP, BMP, recognised by their first bytes, never by their file name.
// Anything else (vector drawings, charts, EMF/WMF) is skipped, and so is anything tiny (bullets, rules) or huge. Nothing in the
// file is ever run: the bytes are only copied out. Plain TypeScript, no DOM.
import { listZip, readZipEntry, readZipText, type ZipEntry } from "$lib/utils/zipRead";
import { parseRels, resolvePartName, slideOrder } from "$lib/utils/pptxText";
import { documentXmlToTextAndImages, readDocumentXml } from "$lib/utils/docxText";
import { sniffImageMime } from "$lib/utils/imageSniff";

/** Where a picture sits: after paragraph `at` of the text ("line"), on slide `at` ("slide"), on page `at` ("page"). */
export type DocImageKind = "slide" | "page" | "line";

export interface DocImage {
  mime: string;
  bytes: Uint8Array;
  kind: DocImageKind;
  at: number;
}

export const MAX_DOC_IMAGES = 60;
/** One picture over this is left out (before it is shrunk). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** All the pictures of one file together, before they are shrunk. */
export const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;
/** Smaller than this is a bullet or a rule, not a picture. */
export const MIN_IMAGE_BYTES = 1500;
const MAX_SLIDES = 1000;
const MAX_XML = 12 * 1024 * 1024;

export { sniffImageMime };

/** Collects pictures while keeping to the limits (count, size of one, size of all). */
export class Collector {
  readonly out: DocImage[] = [];
  private total = 0;
  get full(): boolean {
    return this.out.length >= MAX_DOC_IMAGES || this.total >= MAX_TOTAL_IMAGE_BYTES;
  }
  /** Add a picture's bytes if they are a real, reasonably sized picture. Returns whether it was kept. */
  add(data: Uint8Array, kind: DocImageKind, at: number): boolean {
    if (this.full) return false;
    if (data.length < MIN_IMAGE_BYTES || data.length > MAX_IMAGE_BYTES) return false;
    const mime = sniffImageMime(data);
    if (!mime) return false;
    this.total += data.length;
    this.out.push({ mime, bytes: data, kind, at });
    return true;
  }
  async take(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string, kind: DocImageKind, at: number): Promise<void> {
    if (this.full) return;
    const entry = entries.get(name);
    if (!entry || entry.compSize > MAX_IMAGE_BYTES) return; // (pictures are already compressed, so this is about their size)
    let data: Uint8Array | null = null;
    try {
      data = await readZipEntry(bytes, entry, MAX_IMAGE_BYTES);
    } catch {
      return; // one damaged picture does not stop the rest
    }
    if (data) this.add(data, kind, at);
  }
}

/** The pictures on each slide of a .pptx, in the order they appear on the slide. `at` is the slide's number in presentation order (as in "Slide N"). */
export async function pptxImages(bytes: Uint8Array): Promise<DocImage[]> {
  const entries = listZip(bytes);
  if (!entries || !entries.has("ppt/presentation.xml")) return [];
  const read = async (name: string): Promise<string | null> => {
    const e = entries.get(name);
    return e ? await readZipText(bytes, e, MAX_XML) : null;
  };
  const slides = slideOrder(await read("ppt/presentation.xml"), await read("ppt/_rels/presentation.xml.rels"), entries).slice(0, MAX_SLIDES);
  const c = new Collector();
  for (let i = 0; i < slides.length && !c.full; i++) {
    const part = slides[i];
    const xml = await read(part);
    const relsXml = await read(part.replace(/([^/]+)$/, "_rels/$1.rels"));
    if (xml === null || relsXml === null) continue;
    const rels = parseRels(relsXml);
    const seen = new Set<string>();
    const re = /<a:blip\b[^>]*?\br:embed="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && !c.full) {
      const rel = rels.find((r) => r.id === m![1] && /\/image$/.test(r.type));
      if (!rel) continue;
      const name = resolvePartName(part, rel.target);
      if (seen.has(name)) continue;
      seen.add(name);
      await c.take(bytes, entries, name, "slide", i + 1);
    }
  }
  return c.out;
}

/** The pictures in a .docx, each anchored to the line of text it follows (counted in the lines of docxToText's result). */
export async function docxImages(bytes: Uint8Array): Promise<DocImage[]> {
  const xml = await readDocumentXml(bytes);
  if (xml === null) return [];
  const { refs } = documentXmlToTextAndImages(xml);
  if (refs.length === 0) return [];
  const entries = listZip(bytes);
  const relsEntry = entries?.get("word/_rels/document.xml.rels");
  if (!entries || !relsEntry) return [];
  const relsXml = await readZipText(bytes, relsEntry, MAX_XML);
  if (relsXml === null) return [];
  const rels = parseRels(relsXml);
  const c = new Collector();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (c.full) break;
    const rel = rels.find((r) => r.id === ref.rid && /\/image$/.test(r.type));
    if (!rel) continue;
    const name = resolvePartName("word/document.xml", rel.target);
    const key = `${name}@${ref.afterLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await c.take(bytes, entries, name, "line", ref.afterLine);
  }
  return c.out;
}
