// Round 38 — the text of the editor's current selection, as it should be read
// aloud: blocks separated by one newline, a Shift+Enter line break as a newline.
// null when nothing is selected. Pure (takes the ProseMirror state), so it is
// tested against a real Tiptap editor with partial selections.
import type { EditorState } from "@tiptap/pm/state";

export function selectedText(state: Pick<EditorState, "selection" | "doc">): string | null {
  const { from, to, empty } = state.selection;
  if (empty || from === to) return null;
  const text = state.doc.textBetween(from, to, "\n", "\n");
  return text.trim() ? text : null;
}
