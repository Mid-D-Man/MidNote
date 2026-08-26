// DOM-facing helpers for the contenteditable note body.
//
// REVISION NOTE (this file previously relied on execCommand's own
// internal "sticky typing style" for the no-selection case — toggle
// bold/underline/etc with a collapsed caret and the browser remembers
// to apply it to whatever gets typed next, no extra code needed). That
// turned out to be broken on real-device testing: underline and
// strikethrough could be toggled ON but not back OFF, and — worse —
// the stuck state would resurface in an *unrelated* note later, because
// MidNote is an SPA (client-side routing, no full page reload between
// notes) and that browser-internal state is scoped to the document/
// frame, not to any particular note or contenteditable element. It
// doesn't get cleared just by navigating away.
//
// Fix: for the no-selection case, this file no longer touches
// execCommand's sticky state AT ALL. Instead, the page keeps its own
// explicit `PendingFormats` state (see note/[id]/+page.svelte), fully
// reset on every note load. When a character is then typed, this file
// selects *just that character* after the fact and applies formatting
// to it directly — reusing the exact same selection-based execCommand
// path that was already confirmed working for real (non-collapsed)
// selections, rather than the collapsed-selection path that wasn't.
// Net effect: less reliance on execCommand's own state tracking than
// before, not more.
//
// Still an open, honestly-stated caveat: this can't be exercised by
// scripts/smoke-test.mjs (jsdom has no execCommand at all — confirmed
// empirically, not assumed), and creating-then-collapsing a real
// Selection on every keystroke is a new interaction with the WebView
// that wasn't there before; it's not expected to show any UI (native
// selection handles/context menus are normally tied to a longer-lived,
// gesture-driven selection, not a same-tick programmatic one) but that
// expectation is web-platform knowledge, not an on-device confirmation.
// Worth an eye on the actual device after this build, same as before.

export type InlineFormat = "bold" | "italic" | "underline" | "strikethrough";

const INLINE_COMMAND: Record<InlineFormat, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikeThrough",
};

function safeExec(cmd: string, value?: string): boolean {
  try {
    return document.execCommand(cmd, false, value);
  } catch (err) {
    console.error("richText: execCommand failed for", cmd, err);
    return false;
  }
}

function safeQueryState(cmd: string): boolean {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
}

// Used for the HAS-a-real-selection case only — tapping B/I/U/S in the
// toolbar's selection row, acting on the live selection immediately.
//
// REVISION NOTE: this used to just call execCommand and stop. Real bug,
// confirmed by reproducing it (not just reasoned about): execCommand
// does NOT collapse the selection after formatting it — the same text
// stays actively selected/highlighted. If someone keeps typing right
// after applying a format (an extremely normal thing to do — select a
// word, bold it, keep typing the sentence), the browser's default
// "type over a selection" behavior replaces that selected content, and
// since it was just wrapped in e.g. <strong>, the replacement text
// often lands inside that same tag — so the format silently continues
// into everything typed next, governed by nothing at all. That's what
// "applying to a selection isn't a one-off, it never turns off" was:
// not pendingFormats misbehaving, but this never having been addressed
// in the first place. Fixed by explicitly walking the caret out of the
// formatting element's boundary after applying, into the parent's flow
// — a real DOM reposition, not another appeal to execCommand's own
// state tracking.
export function applyInlineFormat(format: InlineFormat, root: HTMLElement): void {
  safeExec(INLINE_COMMAND[format]);
  collapseOutsideFormatting(root);
}

const FORMATTING_TAGS = new Set(["STRONG", "B", "EM", "I", "U", "S", "STRIKE", "SPAN"]);

// Walks up from wherever the selection currently ends, through any
// chain of the formatting elements execCommand/applyValueStyleToSelection
// just created (handles multiple formats stacked in one go — e.g. bold
// AND colored), and returns a position in the OUTERMOST one's parent,
// immediately after it. That position is structurally outside all of
// the formatting that was just applied, so continued typing there
// starts fresh rather than extending it.
function collapseOutsideFormatting(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const current = sel.getRangeAt(0);

  let node: Node = current.endContainer;
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  let outermost: Element | null = null;
  while (el && el !== root && FORMATTING_TAGS.has(el.tagName)) {
    outermost = el;
    el = el.parentElement;
  }

  if (!outermost || !outermost.parentNode) {
    // Nothing to escape (e.g. execCommand toggled formatting OFF rather
    // than on, so there's no wrapper left at all) — just collapse in
    // place, the original behavior.
    sel.collapseToEnd();
    return;
  }

  const parent = outermost.parentNode;
  const idx = Array.prototype.indexOf.call(parent.childNodes, outermost);
  const range = document.createRange();
  range.setStart(parent, idx + 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
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

export type ListKind = "bullet" | "decimal" | "roman";

export function applyListFormat(kind: ListKind, root: HTMLElement): void {
  if (!safeExec(kind === "bullet" ? "insertUnorderedList" : "insertOrderedList")) return;
  if (kind !== "roman") return;
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
  return li.closest("ol,ul") as HTMLOListElement | HTMLUListElement | null;
}

export function queryActiveList(root: HTMLElement): ListKind | null {
  if (safeQueryState("insertUnorderedList")) return "bullet";
  if (safeQueryState("insertOrderedList")) {
    const list = closestList(root);
    return list && list.style.listStyleType === "lower-roman" ? "roman" : "decimal";
  }
  return null;
}

// --- Value-style formatting (font size / text color / background
// color) for a REAL selection — used by the toolbar's size/color
// pickers when text is selected. No execCommand at all: just wraps the
// selected range in a <span style="..."> directly. Simpler and more
// predictable than execCommand's own font-size/color workarounds, and
// after today there's no reason to add a second execCommand-based
// mechanism when a plain DOM wrap does the same job with fewer moving
// parts.

export interface ValueStyle {
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
}

function wrapRangeInStyledSpan(range: Range, apply: (span: HTMLSpanElement) => void): Range {
  const span = document.createElement("span");
  apply(span);
  try {
    range.surroundContents(span);
  } catch {
    // surroundContents throws if the range's boundaries don't nest
    // cleanly inside one parent (e.g. it partially overlaps two
    // sibling elements) — extract-then-wrap handles that case too.
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  const result = document.createRange();
  result.selectNodeContents(span);
  return result;
}

export function applyValueStyleToSelection(root: HTMLElement, style: ValueStyle): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = wrapRangeInStyledSpan(sel.getRangeAt(0), (span) => {
    if (style.fontSize) span.style.fontSize = `${style.fontSize}px`;
    if (style.color) span.style.color = style.color;
    if (style.backgroundColor) span.style.backgroundColor = style.backgroundColor;
  });
  sel.removeAllRanges();
  sel.addRange(range);
  // Same fix as applyInlineFormat, same bug otherwise — see its comment.
  collapseOutsideFormatting(root);
}

// "None" swatch — clears color/background from a selection. Only
// strips inline style already sitting on elements *inside* the
// selection, plus wraps in an explicit reset span for the common case;
// it will not perfectly un-color text nested inside a still-colored
// ancestor that extends outside the selected range — a known, stated
// limitation rather than a silent gap.
export function clearValueStyleFromSelection(root: HTMLElement, props: ("color" | "backgroundColor")[]): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const scope = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  scope?.querySelectorAll("[style]").forEach((el) => {
    if (!range.intersectsNode(el)) return;
    props.forEach((p) => {
      (el as HTMLElement).style[p] = "";
    });
  });
  const reset = wrapRangeInStyledSpan(range, (span) => {
    props.forEach((p) => {
      span.style[p] = p === "color" ? "var(--text-hi)" : "transparent";
    });
  });
  sel.removeAllRanges();
  sel.addRange(reset);
  collapseOutsideFormatting(root);
}

export function getCurrentFontSize(root: HTMLElement, fallbackPx: number): number {
  const raw = getCurrentStyleProp(root, "fontSize");
  if (!raw) return fallbackPx;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? fallbackPx : Math.round(n);
}

export function getCurrentColor(root: HTMLElement): string | null {
  return getCurrentStyleProp(root, "color");
}

export function getCurrentBackgroundColor(root: HTMLElement): string | null {
  return getCurrentStyleProp(root, "backgroundColor");
}

function getCurrentStyleProp(root: HTMLElement, prop: "fontSize" | "color" | "backgroundColor"): string | null {
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  if (!anchor || !root.contains(anchor)) return null;
  let el: Element | null = anchor instanceof Element ? anchor : anchor.parentElement;
  while (el && el !== root) {
    const inline = el instanceof HTMLElement ? el.style[prop] : "";
    if (inline) return inline;
    el = el.parentElement;
  }
  return null;
}

// --- Pending formats: the no-selection / "sticky for next keystroke"
// case. Owned as explicit page-level state (see note/[id]/+page.svelte)
// rather than left to the browser, for the reasons in this file's
// header comment.

export interface PendingFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fontSize: number | null;
  color: string | null;
  backgroundColor: string | null;
}

export function emptyPendingFormats(): PendingFormats {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    fontSize: null,
    color: null,
    backgroundColor: null,
  };
}

export function hasPendingFormats(f: PendingFormats): boolean {
  return f.bold || f.italic || f.underline || f.strikethrough || f.fontSize !== null || f.color !== null || f.backgroundColor !== null;
}

// Applies every currently-pending format to one Range in one pass:
// toggle formats first via execCommand on a real (if momentary)
// selection — the confirmed-working mechanism — then wraps whatever
// that leaves in a styled span for the value formats. Returns the
// resulting collapsed caret position so the caller can recognize its
// own follow-up selectionchange event and not mistake it for the user
// having tapped/arrowed somewhere else (see refreshFormatState in
// note/[id]/+page.svelte).
export function applyPendingFormatsToRange(range: Range, formats: PendingFormats): { node: Node; offset: number } | null {
  const sel = window.getSelection();
  if (!sel) return null;

  let working = range;

  if (formats.bold || formats.italic || formats.underline || formats.strikethrough) {
    sel.removeAllRanges();
    sel.addRange(working);
    if (formats.bold) safeExec("bold");
    if (formats.italic) safeExec("italic");
    if (formats.underline) safeExec("underline");
    if (formats.strikethrough) safeExec("strikeThrough");
    if (sel.rangeCount > 0) working = sel.getRangeAt(0);
  }

  if (formats.fontSize || formats.color || formats.backgroundColor) {
    working = wrapRangeInStyledSpan(working, (span) => {
      if (formats.fontSize) span.style.fontSize = `${formats.fontSize}px`;
      if (formats.color) span.style.color = formats.color;
      if (formats.backgroundColor) span.style.backgroundColor = formats.backgroundColor;
    });
  }

  sel.removeAllRanges();
  sel.addRange(working);
  sel.collapseToEnd();
  if (sel.rangeCount === 0) return null;
  const final = sel.getRangeAt(0);
  return { node: final.startContainer, offset: final.startOffset };
}

// Called from NoteContent's oninput after a keystroke lands, while any
// format is pending — selects just the characters that were just typed
// and runs them through applyPendingFormatsToRange.
export function wrapLastInsertedText(
  root: HTMLElement,
  insertedLength: number,
  formats: PendingFormats,
): { node: Node; offset: number } | null {
  if (!hasPendingFormats(formats)) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  const offset = sel.anchorOffset;
  const start = Math.max(0, offset - insertedLength);
  if (start >= offset) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, offset);
  return applyPendingFormatsToRange(range, formats);
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
// Forces paste to plain text only — pasting from another app would
// otherwise drag in arbitrary nested spans/colors/fonts that live in
// note.content forever. Also applies whatever's currently pending, so
// pasting while a format is toggled on doesn't feel like it silently
// ignored it.

export function insertPlainText(text: string, formats?: PendingFormats): void {
  const sel = window.getSelection();
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
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
  if (formats && hasPendingFormats(formats) && sel && sel.rangeCount > 0 && sel.isCollapsed) {
    const node = sel.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) {
      const offset = sel.anchorOffset;
      const start = Math.max(0, offset - text.length);
      if (start < offset) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, offset);
        applyPendingFormatsToRange(range, formats);
      }
    }
  }
}

// --- HTML <-> plain text ---

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
