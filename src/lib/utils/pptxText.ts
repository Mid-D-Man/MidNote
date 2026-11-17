// The text of a PowerPoint presentation (.pptx), with no new package.
//
// A .pptx is a ZIP file of XML parts. The slides are ppt/slides/slideN.xml, but their ORDER is in ppt/presentation.xml (a list
// of relationship ids) mapped to files by ppt/_rels/presentation.xml.rels: after slides are rearranged the file numbers no longer
// match the order, so the order is read from there (with the file number as a fallback). Each slide's own rels file points at its
// speaker notes (a notesSlide part), which are included under "Notes:".
//
// WHAT COMES OUT: for each slide, "Slide N", then the text of its shapes in the order they are stored (titles first in practice),
// bullet levels shown by indentation, tables as rows with " | " between cells, then the notes. Pictures, charts, SmartArt, animations,
// slide numbers, dates and footers are left out.
//
// DATA ONLY. Nothing in the file is run or opened: macros, embedded objects, images and links are never touched. Reads are bounded
// (one part, and the total from one file, both capped; slide count capped). Throws ZipError for "needs a newer WebView" / "too large";
// returns null for "not a PowerPoint file".
import { decodeEntities } from "$lib/utils/docxText";
import { listZip, readZipText, type ZipEntry } from "$lib/utils/zipRead";

const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_SLIDES = 1000;
const MAX_CHARS = 600_000;

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
};

/** ppt/slides/slide1.xml, "../notesSlides/notesSlide1.xml" relative to its folder -> ppt/notesSlides/notesSlide1.xml. "/ppt/x.xml" is already complete. */
export function resolvePartName(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/");
  parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

interface Rel {
  id: string;
  type: string;
  target: string;
}

function parseRels(xml: string): Rel[] {
  const rels: Rel[] = [];
  const re = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const mode = attr(m[0], "TargetMode");
    if (mode && mode.toLowerCase() === "external") continue;
    const id = attr(m[0], "Id");
    const type = attr(m[0], "Type");
    const target = attr(m[0], "Target");
    if (id && type && target) rels.push({ id, type, target });
  }
  return rels;
}

const SKIP_PLACEHOLDERS = new Set(["sldNum", "dt", "ftr", "hdr"]);

function paragraphText(p: string): string {
  let out = "";
  const re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) out += m[1] !== undefined ? decodeEntities(m[1]) : "\n";
  return out;
}

function paragraphsOf(xml: string): string[] {
  return xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
}

/** The text lines of one slide (or notes) part: shapes and tables in stored order. */
export function slideXmlToLines(xmlIn: string, indent: boolean): string[] {
  const xml = xmlIn
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "") // alternate content is written twice: keep one
    .replace(/<a:p(?:\s[^>]*)?\/>/g, "<a:p></a:p>") // an empty paragraph written self-closing still counts as one
    .replace(/<a:fld\b[^>]*\btype="(?:slidenum|datetime[^"]*)"[^>]*>[\s\S]*?<\/a:fld>/g, ""); // "‹#›" and today's date
  const lines: string[] = [];
  const blocks = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g) ?? [];
  for (const block of blocks) {
    if (block.startsWith("<p:graphicFrame")) {
      for (const row of block.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) ?? []) {
        const cells = (row.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) ?? []).map((c) =>
          paragraphsOf(c)
            .map((p) => paragraphText(p).replace(/\s+/g, " ").trim())
            .filter((t) => t !== "")
            .join(" "),
        );
        if (cells.some((c) => c !== "")) lines.push(cells.join(" | "));
      }
      continue;
    }
    const ph = /<p:ph\b[^>]*>/.exec(block);
    const phType = ph ? attr(ph[0], "type") : null;
    if (phType && SKIP_PLACEHOLDERS.has(phType)) continue;
    for (const p of paragraphsOf(block)) {
      const text = paragraphText(p).replace(/[ \t]+$/g, "");
      if (text.trim() === "") continue;
      let level = 0;
      if (indent) {
        const pPr = /<a:pPr\b[^>]*>/.exec(p);
        const lvl = pPr ? attr(pPr[0], "lvl") : null;
        level = lvl && /^\d+$/.test(lvl) ? Math.min(parseInt(lvl, 10), 8) : 0;
      }
      lines.push("  ".repeat(level) + text);
    }
  }
  return lines;
}

/** The slide parts in presentation order (file-number order when the order can't be read). */
export function slideOrder(presentationXml: string | null, relsXml: string | null, entries: Map<string, ZipEntry>): string[] {
  const ordered: string[] = [];
  if (presentationXml && relsXml) {
    const byId = new Map(parseRels(relsXml).map((r) => [r.id, r]));
    const re = /<p:sldId\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(presentationXml)) !== null) {
      const rid = attr(m[0], "r:id");
      const rel = rid ? byId.get(rid) : undefined;
      if (!rel) continue;
      const part = resolvePartName("ppt/presentation.xml", rel.target);
      if (entries.has(part) && !ordered.includes(part)) ordered.push(part);
    }
  }
  if (ordered.length > 0) return ordered;
  return [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(/(\d+)\.xml$/.exec(a)![1], 10) - parseInt(/(\d+)\.xml$/.exec(b)![1], 10));
}

/** The text of a PowerPoint presentation, or null when the bytes aren't one. "" when it has no text at all. */
export async function pptxToText(bytes: Uint8Array): Promise<string | null> {
  const entries = listZip(bytes);
  if (!entries || !entries.has("ppt/presentation.xml")) return null;
  let budget = MAX_TOTAL_BYTES;
  const read = async (name: string): Promise<string | null> => {
    const e = entries.get(name);
    if (!e || budget <= 0) return null;
    const text = await readZipText(bytes, e, Math.min(MAX_PART_BYTES, budget));
    if (text !== null) budget -= text.length;
    return text;
  };

  const presentation = await read("ppt/presentation.xml");
  const presRels = await read("ppt/_rels/presentation.xml.rels");
  const slides = slideOrder(presentation, presRels, entries).slice(0, MAX_SLIDES);

  const out: string[] = [];
  let anyText = false;
  let chars = 0;
  for (let i = 0; i < slides.length && chars < MAX_CHARS; i++) {
    const part = slides[i];
    const xml = await read(part);
    const lines = xml === null ? [] : slideXmlToLines(xml, true);

    let notes: string[] = [];
    const slideRels = await read(part.replace(/([^/]+)$/, "_rels/$1.rels"));
    if (slideRels) {
      const rel = parseRels(slideRels).find((r) => /\/notesSlide$/.test(r.type));
      if (rel) {
        const notesXml = await read(resolvePartName(part, rel.target));
        if (notesXml !== null) notes = slideXmlToLines(notesXml, false);
      }
    }

    out.push(`Slide ${i + 1}`);
    if (lines.length === 0 && notes.length === 0) out.push("(no text)");
    else anyText = true;
    out.push(...lines);
    if (notes.length > 0) {
      out.push("Notes:");
      out.push(...notes);
    }
    out.push("");
    chars += lines.join("\n").length + notes.join("\n").length + 12;
  }
  return anyText ? out.join("\n").replace(/\n+$/, "") : "";
}
