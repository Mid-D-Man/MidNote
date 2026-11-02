// Round 34 — what the note editor puts on the clipboard as PLAIN TEXT when
// you select part of a note and copy it.
//
// ProseMirror's default (and Tiptap's ClipboardTextSerializer, which
// replaces it) joins blocks with TWO newlines: three paragraphs copy as
// "a\n\nb\n\nc". That's right for prose pasted into a document, but a note
// here is a list of LINES — one paragraph per line — so the copy came out
// with an empty line between every line. Pasted into another note it became
// a blank paragraph between each line (the paste path in
// plainTextPasteExtension.ts correctly turns each "\n" into a new line, so
// it faithfully reproduced the extra blank). One newline per block fixes
// both: lines copy as lines, and a line you deliberately left empty is still
// an empty line.
//
// Only text/plain changes. text/html is untouched, so pasting between
// MidNote notes (or into an app that reads rich text) keeps bold, colour and
// size exactly as before.
import type { Slice } from "@tiptap/pm/model";
import { cleanPlainText } from "$lib/utils/plainClean";

export function sliceToPlainText(slice: Slice): string {
  // non-breaking spaces and zero-width marks the editor holds are plain spaces / nothing outside it (utils/plainClean.ts)
  return cleanPlainText(slice.content.textBetween(0, slice.content.size, "\n", (leaf) => (leaf.type.name === "hardBreak" ? "\n" : "")));
}
