// Plain-text paste for the note editor (round 27) — replaces the inline
// `handlePaste` NoteContent.svelte got in round 25.
//
// WHY THIS REPLACES ROUND 25
// Round 25 claimed `handlePaste` "skips ProseMirror's HTML-parsing
// pipeline". It doesn't: ProseMirror runs its own clipboard parse
// (parseFromClipboard: readHTML + DOMParser.parseSlice) BEFORE it calls
// `handlePaste`, so the handler only ever got to replace the RESULT of the
// slow path, not avoid it. Measured against a real Tiptap editor in
// jsdom: the pre-parse alone is 2-4x the cost of doing the insert
// ourselves once rich HTML is on the clipboard. Worse, `handlePaste` can't
// help at all when the text never arrives as a `paste` event in the first
// place — see below.
//
// WHAT THIS DOES INSTEAD
//   1. handleDOMEvents.paste — runs BEFORE ProseMirror's own paste code,
//      so the pre-parse never happens. text/plain only, one paragraph per
//      line, inserted as an OPEN slice so the first line joins the line
//      the cursor is in and the last line joins the text after it (what
//      every text editor does; round 25's tr.insert split the current
//      line instead).
//   2. handleDOMEvents.beforeinput — Android keyboards' clipboard
//      button / suggestion chip commit the text through the IME as an
//      `insertText` (or `insertFromPaste`) input event and often fire NO
//      `paste` event at all. That text used to be inserted by the browser
//      itself (one editing command per newline, all inside a
//      contenteditable with a MutationObserver watching), and then
//      re-read from the DOM by ProseMirror — the slowest path there is,
//      and one that produces exactly the reported "lines grouped under
//      one rule / extra blank space" shapes. Cancelling the input event
//      and inserting through a transaction avoids the browser's editing
//      commands entirely. Not cancellable while an IME composition is
//      active (the platform doesn't allow it) — that case falls through
//      to the safety net below.
//   3. appendTransaction safety net — if a raw "\n"/"\r" ever does end up
//      inside a text node (any path we couldn't cancel), split that block
//      into one paragraph per line. Only looks at what the transaction
//      changed, so ordinary typing costs a range check.
//   4. Diagnostics into the on-device debug log (breadcrumb): which path a
//      large insert took, how long our part took, and any big document
//      change that arrived WITHOUT going through 1-3. Built because the
//      real cause of the on-device slowness can't be reproduced off-device;
//      remove once it's understood.
//
// Trade-off, unchanged from round 25 and stated again on purpose: paste is
// ALWAYS plain text, so formatting on content copied from elsewhere
// (including another MidNote note) does not survive.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

const NEWLINE_RE = /\r\n|\r|\n/;
const HAS_NEWLINE_RE = /[\r\n]/;

// A plain `insertText` input event only gets intercepted when it looks
// like a paste (has a newline, or is longer than anyone types in one
// go) — ordinary typing, autocorrect and single-word suggestions must
// keep flowing through the browser and ProseMirror untouched.
const INSERT_TEXT_MIN_LENGTH = 200;
// Diagnostics only log inserts at least this big; everything smaller is
// normal typing and would just fill the 300-entry debug log.
const LOG_MIN_LENGTH = 40;

export interface PlainTextPasteOptions {
  log: (message: string) => void;
}

const pluginKey = new PluginKey("midnotePlainTextPaste");

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Inserts `text` at the selection, one paragraph per line, as an open
// slice (first line joins the current line, last line joins the rest).
// Returns the number of lines inserted.
export function insertPlainTextLines(view: EditorView, text: string): number {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;
  const lines = text.split(NEWLINE_RE);
  const marks = state.storedMarks ?? state.selection.$from.marks();
  const nodes = lines.map((line) => paragraph.create(null, line.length > 0 ? state.schema.text(line, marks) : undefined));
  const tr = state.tr
    .replaceSelection(new Slice(Fragment.from(nodes), 1, 1))
    .scrollIntoView()
    .setMeta("paste", true)
    .setMeta("uiEvent", "paste");
  view.dispatch(tr);
  return lines.length;
}

// ---- safety net -------------------------------------------------------

// Splits one textblock on newline characters inside its text nodes, into
// one block per line, keeping marks. Non-text inline nodes (hard breaks)
// stay where they are. If `cursorOffset` (a content offset inside the
// ORIGINAL block) is given, also returns where that offset lands as
// {block index, content offset inside that new block}.
function splitBlockOnNewlines(
  block: PMNode,
  cursorOffset: number | null
): { blocks: PMNode[]; cursor: { block: number; offset: number } | null } {
  const schema = block.type.schema;
  const lines: PMNode[][] = [[]];
  const sizes: number[] = [0];
  let cursor: { block: number; offset: number } | null = null;
  let src = 0; // offset in the original block's content

  block.forEach((child) => {
    if (!child.isText) {
      if (cursorOffset !== null && !cursor && cursorOffset === src) cursor = { block: lines.length - 1, offset: sizes[sizes.length - 1] };
      lines[lines.length - 1].push(child);
      sizes[sizes.length - 1] += child.nodeSize;
      src += child.nodeSize;
      return;
    }
    const text = child.text as string;
    let segStart = 0;
    const re = /\r\n|\r|\n/g;
    let m: RegExpExecArray | null;
    const segments: Array<{ from: number; to: number; breakAfter: number }> = [];
    while ((m = re.exec(text)) !== null) {
      segments.push({ from: segStart, to: m.index, breakAfter: m[0].length });
      segStart = m.index + m[0].length;
    }
    segments.push({ from: segStart, to: text.length, breakAfter: 0 });

    for (const seg of segments) {
      const piece = text.slice(seg.from, seg.to);
      // The cursor sits inside (or at either end of) this segment.
      if (cursorOffset !== null && !cursor && cursorOffset >= src + seg.from && cursorOffset <= src + seg.to) {
        cursor = { block: lines.length - 1, offset: sizes[sizes.length - 1] + (cursorOffset - (src + seg.from)) };
      }
      if (piece) {
        lines[lines.length - 1].push(schema.text(piece, child.marks));
        sizes[sizes.length - 1] += piece.length;
      }
      if (seg.breakAfter) {
        lines.push([]);
        sizes.push(0);
      }
    }
    src += text.length;
  });
  if (cursorOffset !== null && !cursor && cursorOffset === src) cursor = { block: lines.length - 1, offset: sizes[sizes.length - 1] };

  return {
    blocks: lines.map((nodes) => block.type.create(block.attrs, nodes, block.marks)),
    cursor,
  };
}

// Ranges (in the new document) touched by these transactions.
function changedRanges(transactions: readonly Transaction[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  transactions.forEach((tr, i) => {
    if (!tr.docChanged) return;
    tr.mapping.maps.forEach((map, j) => {
      map.forEach((_os, _oe, ns, ne) => {
        let a = tr.mapping.slice(j + 1).map(ns, -1);
        let b = tr.mapping.slice(j + 1).map(ne, 1);
        for (let k = i + 1; k < transactions.length; k++) {
          a = transactions[k].mapping.map(a, -1);
          b = transactions[k].mapping.map(b, 1);
        }
        out.push([a, b]);
      });
    });
  });
  return out;
}

function normalizeNewlines(transactions: readonly Transaction[], state: EditorState): Transaction | null {
  const hits = new Map<number, PMNode>();
  const size = state.doc.content.size;
  for (const [a, b] of changedRanges(transactions)) {
    const from = Math.max(0, Math.min(a, size));
    const to = Math.max(from, Math.min(b, size));
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        if (HAS_NEWLINE_RE.test(node.textContent)) hits.set(pos, node);
        return false;
      }
      return true;
    });
  }
  if (hits.size === 0) return null;

  const tr = state.tr;
  const sel = state.selection;
  let newCursor: number | null = null;
  // Last block first, so earlier positions stay valid.
  for (const pos of [...hits.keys()].sort((x, y) => y - x)) {
    const node = hits.get(pos) as PMNode;
    const end = pos + node.nodeSize;
    const cursorHere = sel.empty && sel.from > pos && sel.from < end;
    const { blocks, cursor } = splitBlockOnNewlines(node, cursorHere ? sel.from - (pos + 1) : null);
    tr.replaceWith(pos, end, blocks);
    if (cursor) {
      let p = pos;
      for (let i = 0; i < cursor.block; i++) p += blocks[i].nodeSize;
      newCursor = p + 1 + cursor.offset;
    }
  }
  if (newCursor !== null) {
    try {
      tr.setSelection(TextSelection.create(tr.doc, newCursor));
    } catch {
      /* selection left where the mapping put it */
    }
  }
  return tr.setMeta("midnoteNewlineNormalize", true);
}

// ---- extension --------------------------------------------------------

export const PlainTextPaste = Extension.create<PlainTextPasteOptions>({
  name: "plainTextPaste",

  addOptions() {
    return { log: () => {} };
  },

  addProseMirrorPlugins() {
    const log = this.options.log;

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleDOMEvents: {
            paste(view, event) {
              const e = event as ClipboardEvent;
              const text = e.clipboardData?.getData("text/plain");
              if (!text) return false; // image / HTML-only clipboard: leave to the default handling
              const t0 = now();
              e.preventDefault();
              const lines = insertPlainTextLines(view, text);
              const ms = Math.round(now() - t0);
              if (text.length >= LOG_MIN_LENGTH) {
                const htmlLen = e.clipboardData?.getData("text/html")?.length ?? 0;
                log(`paste event: ${text.length} chars, ${lines} lines, clipboard html ${htmlLen} chars -> inserted in ${ms}ms`);
              }
              return true;
            },

            beforeinput(view, event) {
              const e = event as InputEvent;
              const type = e.inputType;
              const interesting =
                type === "insertFromPaste" ||
                type === "insertText" ||
                type === "insertReplacementText" ||
                type === "insertFromYank";
              if (!interesting) return false;

              let text = e.data ?? "";
              if (!text && e.dataTransfer) text = e.dataTransfer.getData("text/plain");
              if (!text) return false;

              const looksLikePaste =
                type === "insertFromPaste" || HAS_NEWLINE_RE.test(text) || text.length >= INSERT_TEXT_MIN_LENGTH;
              if (!looksLikePaste) return false;

              if (e.isComposing || !e.cancelable) {
                log(`beforeinput ${type}: ${text.length} chars NOT interceptable (composing=${e.isComposing}, cancelable=${e.cancelable}) — falling back to the browser + safety net`);
                return false;
              }
              const t0 = now();
              e.preventDefault();
              const lines = insertPlainTextLines(view, text);
              log(`beforeinput ${type}: ${text.length} chars, ${lines} lines intercepted -> inserted in ${Math.round(now() - t0)}ms`);
              return true;
            },

            compositionend(_view, event) {
              const data = (event as CompositionEvent).data ?? "";
              if (data.length >= LOG_MIN_LENGTH || HAS_NEWLINE_RE.test(data)) {
                log(`compositionend: ${data.length} chars${HAS_NEWLINE_RE.test(data) ? " (contains newline)" : ""}`);
              }
              return false;
            },
          },
        },

        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // Diagnostics: a large document change that did NOT come through
          // our own insert (no "paste" meta) was made by the browser and
          // read back out of the DOM — the slow path.
          for (const tr of transactions) {
            if (!tr.docChanged || tr.getMeta("paste") || tr.getMeta("midnoteNewlineNormalize")) continue;
            let grown = 0;
            for (const map of tr.mapping.maps) map.forEach((os, oe, ns, ne) => (grown += Math.max(ne - ns, oe - os)));
            if (grown >= 200) log(`document change of ~${grown} positions arrived via ${tr.getMeta("uiEvent") ?? "the browser DOM (not a paste/beforeinput we saw)"}`);
          }

          return normalizeNewlines(transactions, newState);
        },
      }),
    ];
  },
});
