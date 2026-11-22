// Renaming a tag everywhere (Settings -> Tags; the rules are in utils/tagRename.ts).
//
// The three lists (Notes, Todos, Boards) swap the old name for the new one through the same storage calls adding and removing a
// tag use, so the change reaches the person's other phones like any other tag change. Every item that carries the old name
// (notes, todos, boards, folders, trashed ones too, so a restore does not bring the old name back) is saved with the new one;
// that counts as an edit, which is also what makes the other phones take it.
import * as storage from "$lib/storage";
import type { Entry } from "$lib/types/entry";
import { entries, saveEntry } from "$lib/stores/entries.svelte";
import { sync as syncTagLists } from "$lib/stores/tags.svelte";
import { renameInTags } from "$lib/utils/tagRename";

const SCOPES = ["notes", "todos", "boards"] as const;

/** Every tag name in use or listed: the three lists, plus what items carry. */
export function allTagNames(): string[] {
  const names = new Set<string>();
  const known = storage.loadKnownTags();
  for (const s of SCOPES) for (const t of known[s]) names.add(t);
  for (const e of entries) for (const t of e.tags ?? []) names.add(t);
  return [...names];
}

/** Rename `oldName` to `newName` on the lists and on every item. Returns how many items were changed. */
export function renameTagEverywhere(oldName: string, newName: string): number {
  if (oldName === newName) return 0;
  for (const s of SCOPES) {
    if (!storage.loadKnownTags()[s].includes(oldName)) continue;
    storage.addKnownTag(s, newName);
    storage.removeKnownTag(s, oldName);
  }
  let changed = 0;
  for (const e of [...entries]) {
    const tags = e.tags ?? [];
    if (!tags.includes(oldName)) continue;
    saveEntry({ ...e, tags: renameInTags(tags, oldName, newName) } as Entry);
    changed++;
  }
  syncTagLists();
  return changed;
}
