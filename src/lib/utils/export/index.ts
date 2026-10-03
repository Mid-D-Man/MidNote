// "Export as" entry point (round 30): one function that turns any entry into
// a downloadable TXT, DOCX or PDF. TXT reuses the exact builder the existing
// Export button uses, so the three formats can't disagree about content.
//
// Locked entries are the caller's problem (their content is cleared while
// locked — see the Actions-sheet gate); this never decrypts anything.

import type { Entry } from "$lib/types/entry";
import { buildExportFiles, safeFileName, type ExportedFile } from "$lib/utils/selectionActions";
import { entryToBlocks } from "./blocks";
import { buildDocx } from "./docx";
import { buildPdf } from "./pdf";
import { blocksToMarkdown } from "./markdown";

export type DocFormat = "txt" | "md" | "docx" | "pdf";

export const DOC_FORMATS: ReadonlyArray<{ id: DocFormat; label: string; detail: string }> = [
  { id: "txt", label: "Plain text", detail: ".txt · text only, opens anywhere" },
  { id: "md", label: "Markdown", detail: ".md · bold, italic, lists and checklists as plain text" },
  { id: "docx", label: "Word document", detail: ".docx · keeps bold, colours, lists and checklists" },
  { id: "pdf", label: "PDF", detail: ".pdf · ready to print or send (Latin text only)" },
];

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// .slice() copies into a plain ArrayBuffer — same reason as buildExportFiles'
// zip branch (strict DOM typings reject a Uint8Array view as a BlobPart).
function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.slice()], { type });
}

export function buildEntryDocument(entry: Entry, format: DocFormat): ExportedFile {
  if (format === "txt") return buildExportFiles([entry], "separate")[0];
  const base = safeFileName(entry.title, "MidNote-export");
  const title = entry.title || "Untitled";
  const blocks = entryToBlocks(entry);
  if (format === "md") return { name: `${base}.md`, blob: new Blob([blocksToMarkdown(blocks)], { type: "text/markdown" }) };
  if (format === "docx") return { name: `${base}.docx`, blob: blobOf(buildDocx(blocks, title), DOCX_MIME) };
  return { name: `${base}.pdf`, blob: blobOf(buildPdf(blocks, title), "application/pdf") };
}
