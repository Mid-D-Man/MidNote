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
//   3. appendTransaction safety net — repairs whatever 1 and 2 didn't
//      catch, in two ways:
//        a. a raw "\n"/"\r" that ends up inside a text node is split into
//           one paragraph per line.
//        b. ROUND 28, found on-device (Galaxy A13, build 5cc1358): some
//           inserts reach the editor through NEITHER a `paste` NOR a
//           `beforeinput` event at all — confirmed by this file's own
//           diagnostic log, which recorded "document change of ~2356
//           positions arrived via the browser DOM (not a paste/beforeinput
//           we saw)" for content that then showed up with several
//           originally-separate lines squashed onto one visual note line.
//           This is a real Chromium/WebView behavior: some native/OS-level
//           insert paths (observed alongside a Samsung keyboard clipboard
//           chip) edit the contenteditable DOM directly, bypassing both
//           events entirely, and ProseMirror's own DOM-change detection
//           then parses whatever landed — a browser's own multi-line
//           plain-text insert into a contenteditable typically comes out
//           as ONE paragraph containing several hardBreak (<br>) nodes,
//           not several paragraphs. That's indistinguishable, after the
//           fact, from someone manually pressing Shift+Enter — except
//           that a real Shift+Enter always arrives as its OWN transaction
//           containing exactly one hardBreak node, while this arrives as
//           a single transaction whose inserted content contains several.
//           So: any transaction we didn't originate (no "paste"/
//           "midnoteNewlineNormalize" meta) whose inserted slice contains
//           2+ hardBreak nodes is treated as this case and split into
//           real paragraphs, exactly like (a) above. One hardBreak is
//           always left alone — that's the one case a genuine Shift+Enter
//           and this bug are allowed to look identical, so it's resolved
//           in favor of never touching real Shift+Enter presses.
//      Both only look at what the transaction actually changed, so
//      ordinary typing costs a cheap range check either way.
//   4. Diagnostics into the on-device debug log (breadcrumb): which path a
//      large insert took, how long our part took, and any big document
//      change that arrived WITHOUT going through 1-3 (the log line that
//      surfaced the round 28 bug above). Kept rather than removed —
//      it already earned its place once.
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

// Splits one textblock into one block per line, keeping marks. A line
// break is: a newline character inside a text node (always), and — only
// when `splitHardBreaks` is true — a hardBreak node too (round 28; see
// this file's header). With `splitHardBreaks` false, a hardBreak is left
// in place exactly as before, so a genuine Shift+Enter is never touched.
// If `cursorOffset` (a content offset inside the ORIGINAL block) is
// given, also returns where that offset lands as {block index, content
// offset inside that new block}.
function splitBlockOnBreaks(
  block: PMNode,
  cursorOffset: number | null,
  splitHardBreaks: boolean
): { blocks: PMNode[]; cursor: { block: number; offset: number } | null } {
  const schema = block.type.schema;
  const lines: PMNode[][] = [[]];
  const sizes: number[] = [0];
  let cursor: { block: number; offset: number } | null = null;
  let src = 0; // offset in the original block's content

  block.forEach((child) => {
    if (!child.isText) {
      if (splitHardBreaks && child.type.name === "hardBreak") {
        // The hardBreak itself is dropped, exactly like a "\n" character
        // is dropped below — it's being replaced BY the paragraph break,
        // not carried into either side of it.
        if (cursorOffset !== null && !cursor && cursorOffset === src) cursor = { block: lines.length - 1, offset: sizes[sizes.length - 1] };
        lines.push([]);
        sizes.push(0);
        src += child.nodeSize;
        return;
      }
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

// Ranges (in the new document) touched by transactions passing `include`.
// Position mapping is threaded through EVERY transaction in the batch
// regardless of which ones are included — skipping a non-included
// transaction's own mapping would leave later positions wrong whenever
// the batch has more than one transaction.
function collectRanges(
  transactions: readonly Transaction[],
  include: (tr: Transaction, i: number) => boolean
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  transactions.forEach((tr, i) => {
    if (!tr.docChanged || !include(tr, i)) return;
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

function changedRanges(transactions: readonly Transaction[]): Array<[number, number]> {
  return collectRanges(transactions, () => true);
}

// Round 28: ranges (in the new document) touched by a transaction we did
// NOT originate (no "paste"/"midnoteNewlineNormalize" meta) whose STEPS,
// summed across the whole transaction, inserted 2+ hardBreak nodes.
// Summed across all of a transaction's steps rather than checked one step
// at a time: ProseMirror's own DOM-change detection typically produces
// one step with a multi-hardBreak slice, but the equivalent built by hand
// (as this file's own test suite does, and conceivably some other native
// insert path might too) can just as easily arrive as several steps in
// ONE transaction, each inserting a single hardBreak — which must be
// caught exactly the same way, since it's still one uncaught batch
// introducing several line breaks at once, not several separate real
// Shift+Enter presses (each of which is always its OWN transaction).
function hardBreakInsertRanges(transactions: readonly Transaction[]): Array<[number, number]> {
  return collectRanges(transactions, (tr) => {
    if (tr.getMeta("paste") || tr.getMeta("midnoteNewlineNormalize")) return false;
    let hardBreaks = 0;
    tr.steps.forEach((step) => {
      const slice = (step as unknown as { slice?: Slice }).slice;
      if (!slice) return;
      slice.content.forEach((n) => {
        if (n.type.name === "hardBreak") hardBreaks++;
      });
    });
    // A single hardBreak is exactly what a real Shift+Enter produces —
    // never treat that alone as this bug, no matter how it arrived.
    return hardBreaks >= 2;
  });
}

function repairBrokenLines(
  transactions: readonly Transaction[],
  state: EditorState,
  log: (message: string) => void
): Transaction | null {
  const hits = new Map<number, { node: PMNode; hard: boolean }>();
  const size = state.doc.content.size;

  const mark = (ranges: Array<[number, number]>, hard: boolean) => {
    for (const [a, b] of ranges) {
      const from = Math.max(0, Math.min(a, size));
      const to = Math.max(from, Math.min(b, size));
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock) {
          const prev = hits.get(pos);
          if (hard || !prev) {
            hits.set(pos, { node, hard: hard || (prev?.hard ?? false) });
          }
          return false;
        }
        return true;
      });
    }
  };

  mark(changedRanges(transactions), false);
  // Only widen to hardBreak-splitting for blocks a qualifying step
  // actually touched — never for a block that merely contains an OLD,
  // legitimate multi-line Shift+Enter structure the user built up over
  // separate edits and happened to touch again with an unrelated change.
  for (const [a, b] of hardBreakInsertRanges(transactions)) {
    const from = Math.max(0, Math.min(a, size));
    const to = Math.max(from, Math.min(b, size));
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        hits.set(pos, { node, hard: true });
        return false;
      }
      return true;
    });
  }
  if (hits.size === 0) return null;

  // Only blocks that actually need it (a plain multi-paragraph paste that
  // landed correctly already has no "\n" and no hardBreak run — this
  // never touches it).
  const toFix = [...hits.entries()].filter(
    ([, v]) => HAS_NEWLINE_RE.test(v.node.textContent) || (v.hard && hasHardBreak(v.node))
  );
  if (toFix.length === 0) return null;

  const tr = state.tr;
  const sel = state.selection;
  let newCursor: number | null = null;
  let hardBreaksFixed = 0;
  // Last block first, so earlier positions stay valid.
  for (const [pos, { node, hard }] of toFix.sort((x, y) => y[0] - x[0])) {
    const end = pos + node.nodeSize;
    const cursorHere = sel.empty && sel.from > pos && sel.from < end;
    const { blocks, cursor } = splitBlockOnBreaks(node, cursorHere ? sel.from - (pos + 1) : null, hard);
    if (hard && blocks.length > 1) hardBreaksFixed += blocks.length - 1;
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
  if (hardBreaksFixed > 0) {
    // Only reachable via the round-28 path (a real Shift+Enter is never
    // in `toFix` at all) — logged because this means content arrived
    // through neither of our own two handlers, the same on-device signal
    // that found this bug in the first place.
    log(`paste safety net: split ${hardBreaksFixed} hard-break-joined line(s) back into separate paragraphs (content arrived via neither paste nor beforeinput)`);
  }
  return tr.setMeta("midnoteNewlineNormalize", true);
}

function hasHardBreak(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (child.type.name === "hardBreak") found = true;
  });
  return found;
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

          return repairBrokenLines(transactions, newState, log);
        },
      }),
    ];
  },
});
