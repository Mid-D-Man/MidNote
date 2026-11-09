// Unused-tags sync, part 1: WHEN each tag was added to or removed from a list on this phone.
//
// A tag that no note, todo or board uses lives only in the phone's tag list (storage.ts known tags), which is not an entry,
// so the cloud never saw it. To carry that list between phones the sync needs to know, tag by tag, who changed what last:
// each tag gets a mark [when, present] where `present` is 1 (it is in the list) or 0 (it was taken out of the list: a
// "tombstone", so the removal travels too instead of the tag coming back from another phone).
//
// This file is tiny and imports nothing from the app, so storage.ts can call markTag() from the one place the list changes
// without any risk of an import loop. Marks are kept whether or not settings sync is on, so switching it on later still has times to go by.

export const TAG_SCOPES = ["notes", "todos", "boards"] as const;
export type TagScopeName = (typeof TAG_SCOPES)[number];

/** [when it changed on some phone (ms since 1970; 1 = "was already there before this feature"), 1 = in the list / 0 = taken out]. */
export type TagMark = [number, 0 | 1];
/** tag name -> mark. Built without a prototype so that no tag name (even "__proto__") can ever act as anything but a name. */
export type TagDict = Record<string, TagMark>;
export type TagMarks = Record<TagScopeName, TagDict>;

export const TAG_MARKS_KEY = "midnote:tag-stamps";

export function newDict(): TagDict {
  return Object.create(null) as TagDict;
}

export function emptyMarks(): TagMarks {
  return { notes: newDict(), todos: newDict(), boards: newDict() };
}

export type StampStorage = Pick<Storage, "getItem" | "setItem">;

/** One mark as read from untrusted text, or null when it is not [positive number, 0 or 1]. */
export function readMark(v: unknown): TagMark | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [t, f] = v as unknown[];
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  if (f !== 0 && f !== 1) return null;
  return [t, f];
}

/** The marks from their stored text. Anything that is not a plain mark for a known list is dropped. */
export function parseTagMarks(raw: string | null): TagMarks {
  const out = emptyMarks();
  if (!raw) return out;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!o || typeof o !== "object") return out;
  const m = (o as { marks?: unknown }).marks;
  if (!m || typeof m !== "object") return out;
  for (const scope of TAG_SCOPES) {
    const d = (m as Record<string, unknown>)[scope];
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    for (const name of Object.keys(d)) {
      if (name.length === 0 || name.length > 200) continue;
      const mark = readMark((d as Record<string, unknown>)[name]);
      if (mark) out[scope][name] = mark;
    }
  }
  return out;
}

export function serializeTagMarks(marks: TagMarks): string {
  return JSON.stringify({ v: 1, marks });
}

function realStorage(): StampStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadTagMarks(storage: StampStorage | null = realStorage()): TagMarks {
  if (!storage) return emptyMarks();
  try {
    return parseTagMarks(storage.getItem(TAG_MARKS_KEY));
  } catch {
    return emptyMarks();
  }
}

export function saveTagMarks(marks: TagMarks, storage: StampStorage | null = realStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(TAG_MARKS_KEY, serializeTagMarks(marks));
  } catch {
    /* storage full or blocked: the tag list still works, it just won't win a conflict */
  }
}

/** Record that `tag` was just added to (present = true) or taken out of (false) the `scope` list here. */
export function markTag(
  scope: TagScopeName,
  tag: string,
  present: boolean,
  now: number = Date.now(),
  storage: StampStorage | null = realStorage(),
): void {
  if (!(TAG_SCOPES as readonly string[]).includes(scope)) return;
  const marks = loadTagMarks(storage);
  const prev = marks[scope][tag];
  // always newer than what was there, even if the clock went backwards
  marks[scope][tag] = [Math.max(now, (prev ? prev[0] : 0) + 1), present ? 1 : 0];
  saveTagMarks(marks, storage);
}
