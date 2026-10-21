// Round F — AI on a selection in the note editor: what to send, and how to apply the answer.
//
// Plain TypeScript over ProseMirror's state (no Svelte), so it is tested against a real Tiptap editor.
//
//   captureSelection   reads the selection (+ the note text around it, nearest 6,000 characters each way)
//                      and the formatting of its first character. Taken when the AI button is tapped:
//                      everything after works from this snapshot.
//   planReplace        the transaction that swaps the selection for the AI's answer. ONE transaction, so
//                      ONE undo step. Refuses (returns "stale") when the text under the old range is no
//                      longer what was selected, so an answer can never land on the wrong words.
//   planInsertBelow    the answer as new paragraphs after the block the selection ends in.
//
// Nothing here dispatches: the caller applies a plan only when the person taps the button for it.
import { Fragment, Slice, type Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { AiEditMode } from "$lib/online/aiClient";

/** How much of the note on EACH side of the selection the phone sends. (The server trims further to fit.) */
export const CONTEXT_CHARS = 6000;
/** Above this an edit answer may not fit the model's output allowance (~900 tokens): the sheet warns. */
export const LONG_SELECTION_CHARS = 2500;

export interface AiSelection {
  from: number;
  to: number;
  /** The selected text, blocks separated by one newline (the same text the read-aloud button reads). */
  text: string;
  /** The note text before / after the selection, in the same format. */
  before: string;
  after: string;
  /** The marks (bold, colour, font...) of the first selected character; a replacement inherits them. */
  marks: readonly Mark[];
}

export function captureSelection(state: Pick<EditorState, "selection" | "doc">): AiSelection | null {
  const { from, to, empty } = state.selection;
  if (empty || from === to) return null;
  const { doc } = state;
  const text = doc.textBetween(from, to, "\n", "\n");
  if (!text.trim()) return null;

  // positions are at least as many as characters; 3x is plenty to find CONTEXT_CHARS of text
  const reach = CONTEXT_CHARS * 3;
  // (a selection that starts at the start of a block still gets a newline at the end of `before`, and one that
  // ends at the end of a block a newline at the start of `after`: textBetween adds a separator whenever its range
  // ENTERS another block, even an empty part of it. Tested, so a change in ProseMirror would show.)
  const before = doc.textBetween(Math.max(0, from - reach), from, "\n", "\n").slice(-CONTEXT_CHARS);
  const after = doc.textBetween(to, Math.min(doc.content.size, to + reach), "\n", "\n").slice(0, CONTEXT_CHARS);

  let marks: readonly Mark[] = [];
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (!found && node.isText) {
      found = true;
      marks = node.marks;
    }
    return !found;
  });
  return { from, to, text, before, after, marks };
}

/**
 * The answer as lines, one paragraph each. Blank lines are collapsed to one, or dropped altogether when the
 * original selection had none (a model likes to double-space paragraphs the note keeps single-spaced).
 */
export function replyLines(reply: string, original: string): string[] {
  const keepBlank = /\n[ \t]*\n/.test(original);
  const out: string[] = [];
  for (const raw of reply.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/[ \t]+$/, "");
    if (line.trim() === "") {
      if (keepBlank && out.length > 0 && out[out.length - 1] !== "") out.push("");
    } else out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

function paragraphs(schema: Schema, lines: string[], marks: readonly Mark[]): PMNode[] {
  const p = schema.nodes.paragraph;
  return lines.map((l) => p.create(null, l ? schema.text(l, marks) : undefined));
}

export type Plan = { ok: true; tr: Transaction } | { ok: false; reason: "stale" | "empty" };

/** Replaces the selection with `reply`: the first line joins the text before it, the last the text after it. */
export function planReplace(state: EditorState, sel: AiSelection, reply: string): Plan {
  const { doc } = state;
  if (sel.to > doc.content.size || sel.from < 0 || doc.textBetween(sel.from, sel.to, "\n", "\n") !== sel.text) return { ok: false, reason: "stale" };
  const lines = replyLines(reply, sel.text);
  if (lines.length === 0) return { ok: false, reason: "empty" };
  const tr = state.tr.replace(sel.from, sel.to, new Slice(Fragment.from(paragraphs(state.schema, lines, sel.marks)), 1, 1));
  const end = tr.mapping.map(sel.to, 1);
  return { ok: true, tr: tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1)).scrollIntoView() };
}

/** Where a block inserted "below the selection" goes: the end of the top-level block the selection ends in. */
export function belowPosition(doc: PMNode, from: number, to: number): number {
  const $to = doc.resolve(to);
  // a selection that ends at the very start of a block (a triple tap, a drag past the end of a line) ends in the block BEFORE it
  const ref = $to.parentOffset === 0 && to > from ? doc.resolve(to - 1) : $to;
  return ref.depth === 0 ? ref.pos : ref.after(1);
}

/** Inserts `reply` as new paragraphs below the selection (plain: no inherited formatting). */
export function planInsertBelow(state: EditorState, sel: AiSelection, reply: string): Plan {
  const { doc } = state;
  if (sel.to > doc.content.size || sel.from < 0 || doc.textBetween(sel.from, sel.to, "\n", "\n") !== sel.text) return { ok: false, reason: "stale" };
  const lines = replyLines(reply, sel.text);
  if (lines.length === 0) return { ok: false, reason: "empty" };
  const nodes = paragraphs(state.schema, lines, []);
  const pos = belowPosition(doc, sel.from, sel.to);
  const tr = state.tr.insert(pos, nodes);
  const size = nodes.reduce((n, node) => n + node.nodeSize, 0);
  return { ok: true, tr: tr.setSelection(TextSelection.near(tr.doc.resolve(pos + size), -1)).scrollIntoView() };
}

// ---------------------------------------------------------------- quick actions

export interface AiChip {
  id: string;
  label: string;
  instruction: string;
  mode: AiEditMode;
}

export const EDIT_CHIPS: readonly AiChip[] = [
  { id: "improve", label: "Improve", instruction: "Improve the writing: clearer and smoother, same meaning.", mode: "edit" },
  { id: "grammar", label: "Fix grammar", instruction: "Fix spelling and grammar. Change nothing else.", mode: "edit" },
  { id: "shorter", label: "Shorter", instruction: "Make it shorter. Keep the meaning.", mode: "edit" },
  { id: "longer", label: "Longer", instruction: "Make it longer by adding relevant detail. Keep the meaning and the voice.", mode: "edit" },
  { id: "friendlier", label: "Friendlier", instruction: "Make the tone warmer and friendlier.", mode: "edit" },
  { id: "formal", label: "More formal", instruction: "Make the tone more formal and professional.", mode: "edit" },
  { id: "continue", label: "Continue", instruction: "Continue the note from here.", mode: "continue" },
];

export const ASK_CHIPS: readonly AiChip[] = [
  { id: "explain", label: "Explain", instruction: "Explain this in simple words.", mode: "ask" },
  { id: "summarize", label: "Summarize", instruction: "Summarize this in a few sentences.", mode: "ask" },
  { id: "points", label: "Key points", instruction: "List the key points.", mode: "ask" },
];
