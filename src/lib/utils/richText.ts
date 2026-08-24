// DOM-facing helpers for the contenteditable note body. Everything in
// here leans on document.execCommand and the live Selection API rather
// than the plain-text-offset approach the old <textarea> toolbar used —
// see NoteContent.svelte and note/[id]/+page.svelte for why that
// changed (short version: a <textarea> cannot render mixed formatting
// at all, so "make the toolbar actually apply real bold/italic instead
// of inserting ** characters" was never solvable without moving to a
// real editable element).
//
// IMPORTANT CAVEAT, stated plainly rather than buried: document.execCommand
// is a deprecated web API. It is used here deliberately — for bold/
// italic/underline/strikethrough it is still the only thing that gives
// "applies to the selection if there is one, otherwise sets a sticky
// style for whatever gets typed next" for free, which is exactly the
// two-state behavior asked for (compare: FlyNote's own reference
// screenshots showing a different toolbar row depending on whether text
// is selected). It remains implemented in Chromium (and so in Android's
// System WebView, which is what Tauri's Android build actually runs in)
// as of this writing, but "deprecated" means it could change. This is a
// real, named trade-off, not a hidden one.
//
// The other important caveat: NONE of this can be exercised by
// scripts/smoke-test.mjs. jsdom does not implement execCommand or
// realistic contenteditable typing/selection behavior at all — calling
// document.execCommand under jsdom is a no-op at best. The smoke test
// still catches "does the note page mount without throwing," which is
// what actually caused the last incident, but the rich-text behavior
// itself needs a real on-device check. Flagging that here so it isn't a
// silent gap.

export type InlineFormat = "bold" | "italic" | "underline" | "strikethrough";

const INLINE_COMMAND: Record<InlineFormat, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikeThrough",
};

export function applyInlineFormat(format: InlineFormat): void {
  try {
    document.execCommand(INLINE_COMMAND[format], false);
  } catch (err) {
    console.error("richText: execCommand failed for", format, err);
  }
}

function safeQueryState(cmd: string): boolean {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

export function queryActiveFormats(): ActiveFormats {
  return {
    bold: safeQueryState("bold"),
    italic: safeQueryState("italic"),
    underline: safeQueryState("underline"),
    strikethrough: safeQueryState("strikeThrough"),
  };
}

// --- Lists ---
// Native contenteditable list commands replace the old regex-based
// plain-text list logic (matchList/applyListFormat/handleEnter in the
// now-deleted textEditing.ts) — that logic depended entirely on
// textarea.selectionStart, a property a contenteditable div doesn't
// have, and on `note.content` being plain text, which it no longer is.
// Enter-to-continue-a-list is no longer hand-rolled either: native
// contenteditable already continues <li> items on Enter and exits an
// empty trailing one, which is what that custom code was replicating.

export type ListKind = "bullet" | "decimal" | "roman";

export function applyListFormat(kind: ListKind, root: HTMLElement): void {
  try {
    document.execCommand(kind === "bullet" ? "insertUnorderedList" : "insertOrderedList", false);
  } catch (err) {
    console.error("richText: execCommand failed for list", kind, err);
    return;
  }
  if (kind !== "roman") return;
  // insertOrderedList only ever produces a plain decimal <ol> — roman
  // numerals aren't a native list type, so force it with CSS on
  // whichever <ol> the selection now sits inside.
  const list = closestList(root);
  if (list) list.style.listStyleType = "lower-roman";
}

function closestList(root: HTMLElement): HTMLOListElement | HTMLUListElement | null {
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  if (!anchor) return null;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  const li = el?.closest("li");
  if (!li || !root.contains(li)) return null;
  const list = li.closest("ol,ul");
  return list as HTMLOListElement | HTMLUListElement | null;
}

export function queryActiveList(root: HTMLElement): ListKind | null {
  if (safeQueryState("insertUnorderedList")) return "bullet";
  if (safeQueryState("insertOrderedList")) {
    const list = closestList(root);
    return list && list.style.listStyleType === "lower-roman" ? "roman" : "decimal";
  }
  return null;
}

// --- Font size ---
// execCommand has no "set this exact CSS px value" command. The
// standard workaround (predates this project by a couple of decades —
// it's how execCommand-based editors have always done arbitrary font
// sizes): ask for a *legacy* HTML size via the "fontSize" command,
// which marks the selection (or the caret, if nothing's selected) with
// a <font size="7">, then immediately swap every one of those for a
// <span style="font-size:Npx"> with the real value. Using the browser's
// own command to do the marking is what makes the "sticky when nothing
// is selected" behavior come along for free — same mechanism as bold.

const FONT_SIZE_MARKER = "7";

export function applyFontSize(root: HTMLElement, sizePx: number): void {
  try {
    document.execCommand("fontSize", false, FONT_SIZE_MARKER);
  } catch (err) {
    console.error("richText: execCommand failed for fontSize", err);
    return;
  }

  const fonts = root.querySelectorAll(`font[size="${FONT_SIZE_MARKER}"]`);
  if (fonts.length === 0) return;

  let lastSpan: HTMLSpanElement | null = null;
  let lastWasEmpty = false;
  fonts.forEach((font) => {
    const span = document.createElement("span");
    span.style.fontSize = `${sizePx}px`;
    lastWasEmpty = font.childNodes.length === 0;
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
    lastSpan = span;
  });

  // Nothing was selected when this ran — execCommand marked the bare
  // caret position with an empty <font>, now an empty <span>. The caret
  // needs to land back inside that span, or the "whatever's typed next
  // inherits this size" half of the feature doesn't happen.
  if (lastSpan && lastWasEmpty) {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(lastSpan);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

export function getCurrentFontSize(root: HTMLElement, fallbackPx: number): number {
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  if (!anchor || !root.contains(anchor)) return fallbackPx;
  let el: Element | null = anchor instanceof Element ? anchor : anchor.parentElement;
  while (el && el !== root) {
    const inline = el instanceof HTMLElement ? el.style.fontSize : "";
    if (inline) {
      const n = parseFloat(inline);
      if (!Number.isNaN(n)) return Math.round(n);
    }
    el = el.parentElement;
  }
  return fallbackPx;
}

// --- Selection state ---

export function readSelectionState(root: HTMLElement): { within: boolean; hasSelection: boolean } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !root.contains(sel.anchorNode)) {
    return { within: false, hasSelection: false };
  }
  return { within: true, hasSelection: !sel.isCollapsed };
}

// --- Paste ---
// Forces paste to plain text only. Without this, pasting from another
// app (Chrome, WhatsApp, Google Keep, ...) drags in arbitrary nested
// spans/colors/fonts that would otherwise live in note.content forever.
// Keeps the stored HTML to only the tags this editor itself produces.

export function insertPlainText(text: string): void {
  try {
    if (document.execCommand("insertText", false, text)) return;
  } catch {
    // fall through to manual Range insertion below
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

// --- HTML <-> plain text ---

// Card previews, search, and the .txt export all need plain text, not
// raw markup. Building a detached element and reading .textContent back
// is the standard safe way to do this — setting innerHTML never
// executes any <script> content regardless of whether the element is
// attached to the document, and this element never gets attached.
export function stripHtml(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

// For turning plain text (e.g. the AI note creator's stub output) into
// safe content for the contenteditable body — escapes the characters
// that would otherwise be parsed as markup and preserves line breaks.
export function plainTextToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// Readable plain text for the .txt export — like stripHtml, but keeps
// line breaks instead of collapsing them to spaces, since a downloaded
// note should still read as one item per line.
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
