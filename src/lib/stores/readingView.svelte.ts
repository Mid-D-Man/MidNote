// Reading view: the one setting it has. "Markdown" on = what was typed in the note is read as Markdown (# headings, **bold**,
// tables, ``` code); off = the text shows exactly as typed and only the editor's own formatting (bold, italic, underline,
// strike, lists, checklists) is drawn. Per phone on purpose (it is a reading habit, not a document property).
const KEY = "midnote:reading-markdown";

function load(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(KEY) !== "false";
  } catch {
    return true;
  }
}

export const readingMarkdown = $state({ value: load() });

export function setReadingMarkdown(on: boolean) {
  readingMarkdown.value = on;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, String(on));
  } catch {
    /* storage blocked: the switch still works until the app closes */
  }
}
