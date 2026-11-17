// Reading view: which format each note is read as. Remembered per note and per phone (a reading habit, not part of the note),
// so a source file opened with "Open with" keeps showing as code and a story keeps showing as Markdown.
// The format list, the guessing and the drawing are in utils/readingFormat.ts.
import { isFormat, type ReadingFormat } from "$lib/utils/readingFormat";
import { clampZoom, parseZoom, ZOOM_DEFAULT } from "$lib/utils/codeZoom";

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

// How big code is drawn in Reading view (A- / A+ in the bottom bar, or a two-finger pinch on a code block). One size for the whole
// phone, kept between visits. The rules are in utils/codeZoom.ts.
const ZOOM_KEY = "midnote:reading-code-zoom";

function loadZoom(): number {
  try {
    if (typeof localStorage === "undefined") return ZOOM_DEFAULT;
    return parseZoom(localStorage.getItem(ZOOM_KEY));
  } catch {
    return ZOOM_DEFAULT;
  }
}

export const codeZoom = $state<{ value: number }>({ value: loadZoom() });

/** Shows a size right away without remembering it yet (used while two fingers are still moving). */
export function previewCodeZoom(zoom: number): void {
  codeZoom.value = clampZoom(zoom);
}

/** Remembers the size now showing. */
export function saveCodeZoom(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ZOOM_KEY, String(codeZoom.value));
  } catch {
    /* storage blocked: the size lasts until the page closes */
  }
}

/** Sets the size and remembers it (the A- / A+ buttons). */
export function setCodeZoom(zoom: number): void {
  previewCodeZoom(zoom);
  saveCodeZoom();
}
