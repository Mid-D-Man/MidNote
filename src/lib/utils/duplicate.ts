// Round 34 — what "Duplicate" carries over.
//
// The three headers' Duplicate handlers used to copy only a few fields. The
// note's copied title, text and tags — and silently dropped every extra PAGE,
// the first page's name, and the header/body theme and icon; the todo and
// board kept their content but lost theme and icon. So a duplicate of a
// styled, multi-page note looked like a plain one-page note.
//
// What a copy takes: the content, plus how the entry LOOKS (themes, icon).
// What it deliberately leaves behind, because it belongs to the original and
// would be wrong or surprising on a second item: comments (private remarks
// about that entry), reminder, pin, bookmark, strike-through, lock state and
// trash state — the copy starts as a plain, unlocked, un-pinned entry.
import type { EntryRef, Note, NotePage } from "$lib/types/entry";

// Reactive proxies and shared references both make "copy" quietly mean
// "same object": a JSON round-trip is a real, independent copy of plain data.
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Carry the original's appearance onto `copy`. */
export function copyAppearance(from: EntryRef, copy: EntryRef): void {
  copy.headerTheme = plain(from.headerTheme);
  copy.bodyTheme = plain(from.bodyTheme);
  copy.icon = from.icon ? plain(from.icon) : null;
}

/** Copy the original's extra pages and first-page name onto `copy`, with fresh page ids. */
export function copyNotePages(from: Note, copy: Note, makeId: () => string): void {
  copy.page1Name = from.page1Name;
  copy.pages = from.pages.map((p: NotePage) => ({ ...plain(p), id: makeId() }));
}
