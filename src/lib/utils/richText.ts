// Pure HTML <-> plain-text conversion helpers. No DOM formatting logic,
// no execCommand, no Selection/Range manipulation — that entire layer
// (previously most of this file: PendingFormats, applyInlineFormat,
// wrapLastInsertedText, applyValueStyleToSelection/CapturedRange,
// collapseOutsideFormatting/escapeInlineFormattingContext, safeExec,
// readSelectionState, and everything downstream of them) is gone,
// replaced by Tiptap/ProseMirror's own document model in
// NoteContent.svelte — see that file's header comment for why.
//
// What's left here is genuinely independent of that change: converting
// between HTML and plain text for note previews (stripHtml, NoteCard),
// export (htmlToPlainText, selectionActions.ts), and pasting plain text
// into a note (plainTextToHtml, the list-view "new note" flow). None of
// this touches a live editor or a Selection — safe, ordinary string/DOM
// parsing, unaffected by which rich-text engine renders the editor
// itself.

export function stripHtml(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function plainTextToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  el.querySelectorAll("div,p,li").forEach((block) => {
    block.after("\n");
  });
  return (el.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
