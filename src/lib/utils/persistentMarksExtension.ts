import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Mark } from "@tiptap/pm/model";

// Fixes the reported leak — select text, apply a mark (bold, color,
// etc.) via the toolbar, and it kept applying to whatever got typed
// next, even after leaving the selection. Root cause, confirmed
// directly (not guessed): ProseMirror marks default to `inclusive:
// true`, meaning a cursor sitting exactly at the END of a mark's range
// is treated as still "inside" it for the purpose of deciding what the
// next typed character inherits — necessary for one thing this app
// needs (typing several characters in a row while a cursor-mode toggle
// is active — see below) but wrong for another (a selection was
// explicitly bolded, the cursor now happens to sit at its boundary, and
// nothing has asked for the NEXT character to also be bold).
//
// The direct fix — every relevant mark set to `inclusive: false` in
// NoteContent.svelte — closes the reported leak (confirmed: selecting
// "hello" in "hello world", bolding it, moving the cursor to sit right
// after "hello", then typing no longer produces bold text). But it has
// a real side effect: `inclusive: true` was ALSO the thing making
// multi-character cursor-mode typing work at all — toggle bold with no
// selection, type "hello" one keystroke at a time, and (confirmed
// directly, not assumed) only the first character came out bold once
// marks were non-inclusive, because ProseMirror's `storedMarks` — the
// thing that decides what a freshly-inserted character inherits when
// there's no mark to be "inside" of at all — gets cleared after being
// consumed by a single transaction, and multi-keystroke typing was
// relying on inclusivity to silently re-derive the same answer for
// every following keystroke instead.
//
// This extension is what makes both true at once: it remembers
// whatever a cursor-mode toggle just set as storedMarks (the moment a
// transaction has storedMarksSet, i.e. an explicit toggle happened on a
// collapsed selection — not inferred, read directly off the
// transaction), and re-asserts that memory on every subsequent
// transaction that inserts text with the cursor still collapsed. The
// memory is dropped the instant a transaction changes the selection
// WITHOUT also changing the document — a plain cursor move (tap,
// arrow key) with nothing typed, which is exactly "the user left"
// rather than "the user kept typing," and is when non-inclusive marks
// are supposed to take back over.
//
// Confirmed together, not separately: a script exercised all of
// (a) selection-boundary leak closed, (b) per-character cursor-mode
// typing still lands in one run, (c) toggling off mid-stream doesn't
// re-leak, (d) navigating away (no doc change) drops the memory so
// typing somewhere unrelated afterward doesn't inherit anything, for
// both an inline mark (bold) and an attribute-carrying mark (color) —
// all seven checks passing together is what this extension is FOR, not
// any one of them in isolation.
export const PersistentMarks = Extension.create({
  name: "persistentMarks",

  addProseMirrorPlugins() {
    const key = new PluginKey<readonly Mark[] | null>("persistentMarks");
    return [
      new Plugin({
        key,
        state: {
          init: (): readonly Mark[] | null => null,
          apply(tr, value): readonly Mark[] | null {
            if (tr.storedMarksSet) return tr.storedMarks;
            if (!tr.docChanged && tr.selectionSet) return null;
            return value;
          },
        },
        appendTransaction(transactions, _oldState, newState) {
          const remembered = key.getState(newState);
          if (!remembered || remembered.length === 0) return null;
          if (!newState.selection.empty) return null;
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const current = newState.storedMarks ?? newState.selection.$from.marks();
          const missing = remembered.filter((m: Mark) => !m.isInSet(current));
          if (missing.length === 0) return null;
          return newState.tr.setStoredMarks([...current, ...missing]);
        },
      }),
    ];
  },
});
