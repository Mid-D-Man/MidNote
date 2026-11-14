// Reading view: which format each note is read as. Remembered per note and per phone (a reading habit, not part of the note),
// so a source file opened with "Open with" keeps showing as code and a story keeps showing as Markdown.
// The format list, the guessing and the drawing are in utils/readingFormat.ts.
import { isFormat, type ReadingFormat } from "$lib/utils/readingFormat";

const KEY = "midnote:reading-formats";
/** At most this many notes are remembered; the oldest choices are forgotten first. */
export const MAX_REMEMBERED = 300;

function load(): Record<string, ReadingFormat> {
  const out: Record<string, ReadingFormat> = Object.create(null) as Record<string, ReadingFormat>;
  if (typeof localStorage === "undefined") return out;
  try {
    const o: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const id of Object.keys(o)) {
      const v = (o as Record<string, unknown>)[id];
      if (id.length > 0 && id.length <= 128 && isFormat(v)) out[id] = v;
    }
  } catch {
    /* unreadable: start empty */
  }
  return out;
}

/** The format chosen (or set by "Open with") for this note, or null when none was. */
export function getReadingFormat(noteId: string): ReadingFormat | null {
  return load()[noteId] ?? null;
}

/** Remembers the format for this note. */
export function setReadingFormat(noteId: string, format: ReadingFormat): void {
  if (typeof localStorage === "undefined" || noteId === "" || noteId.length > 128) return;
  const all = load();
  delete all[noteId]; // a fresh choice goes to the end (the newest)
  all[noteId] = format;
  const ids = Object.keys(all);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_REMEMBERED))) delete all[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: the choice lasts until the page closes */
  }
}
