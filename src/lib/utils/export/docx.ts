// Minimal .docx writer (round 30). No new dependency: a .docx is a zip of a
// few XML parts, and fflate — already used for the multi-note .zip export —
// writes the zip.
//
// Parts written (the smallest set Word, LibreOffice, Google Docs and WPS all
// open without a repair prompt):
//   [Content_Types].xml   what each part is
//   _rels/.rels           points at the main document + properties
//   word/document.xml     the body
//   word/_rels/document.xml.rels   points at styles
//   word/styles.xml       Normal / Title / Heading1 (so Word's navigation
//                         pane sees the note title and page names)
//   docProps/core.xml     title + creator
//
// Element order inside <w:pPr> and <w:rPr> follows the OOXML schema's
// sequence on purpose — Word is strict about it where LibreOffice is not.

import { zipSync, strToU8 } from "fflate";
import type { Block, Run } from "./blocks";

const PT_PER_PX = 0.75;
const DEFAULT_PT = 11;

// XML 1.0 forbids most control characters outright (a stray one makes Word
// declare the file corrupt), and lone surrogates are not valid text either.
function cleanXmlText(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
}

function esc(s: string): string {
  return cleanXmlText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rPr(run: Run, extra: { bold?: boolean; sizePt?: number } = {}): string {
  const parts: string[] = [];
  if (run.bold || extra.bold) parts.push("<w:b/>");
  if (run.italic) parts.push("<w:i/>");
  if (run.strike) parts.push("<w:strike/>");
  if (run.color) parts.push(`<w:color w:val="${run.color.toUpperCase()}"/>`);
  const pt = extra.sizePt ?? (run.sizePx ? run.sizePx * PT_PER_PX : undefined);
  if (pt) parts.push(`<w:sz w:val="${Math.max(2, Math.round(pt * 2))}"/>`);
  if (run.underline) parts.push('<w:u w:val="single"/>');
  if (run.highlight) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${run.highlight.toUpperCase()}"/>`);
  return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}

function runXml(run: Run, extra?: { bold?: boolean; sizePt?: number }): string {
  const props = rPr(run, extra);
  // "\n" = a hard break inside the paragraph; "\t" = a tab stop.
  const pieces = run.text.split(/(\n|\t)/);
  const inner = pieces
    .map((piece) => {
      if (piece === "\n") return "<w:br/>";
      if (piece === "\t") return "<w:tab/>";
      return piece ? `<w:t xml:space="preserve">${esc(piece)}</w:t>` : "";
    })
    .join("");
  return inner ? `<w:r>${props}${inner}</w:r>` : "";
}

const LIST_LEFT_TWIPS = 360; // text indent per level
const LIST_HANG_TWIPS = 360;

function paragraphXml(b: Block): string {
  if (b.spacer && b.runs.length === 0) return "<w:p/>";

  const pPr: string[] = [];
  if (b.kind === "title") pPr.push('<w:pStyle w:val="Title"/>');
  else if (b.kind === "heading") pPr.push('<w:pStyle w:val="Heading1"/>');
  if (b.prefix) {
    const left = LIST_LEFT_TWIPS * ((b.level ?? 0) + 1) + LIST_HANG_TWIPS;
    pPr.push(`<w:ind w:left="${left}" w:hanging="${LIST_HANG_TWIPS}"/>`);
  } else if (b.level) {
    pPr.push(`<w:ind w:left="${LIST_LEFT_TWIPS * (b.level + 1) + LIST_HANG_TWIPS}"/>`);
  }

  const body: string[] = [];
  if (b.prefix) body.push(`<w:r><w:t xml:space="preserve">${esc(b.prefix)}</w:t></w:r><w:r><w:tab/></w:r>`);
  // Title / heading runs take their look from the paragraph style; keeping
  // per-run bold/size off them lets Word's own style control it.
  for (const r of b.runs) body.push(runXml(b.kind === "para" ? r : { ...r, bold: undefined, sizePx: undefined }));

  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}${body.join("")}</w:p>`;
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="${DEFAULT_PT * 2}"/><w:szCs w:val="${DEFAULT_PT * 2}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;

export function buildDocx(blocks: Block[], title: string): Uint8Array {
  const body = blocks.map(paragraphXml).join("");
  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>MidNote</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

  // [Content_Types].xml first: some strict readers look for it at the
  // start of the archive (fflate keeps object insertion order).
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "word/document.xml": strToU8(document),
    "word/_rels/document.xml.rels": strToU8(DOC_RELS),
    "word/styles.xml": strToU8(STYLES),
    "docProps/core.xml": strToU8(core),
  });
}
