// Renaming a tag (Settings -> Tags). Pure rules, no Svelte: what a typed name means, and how a tag list changes.
//
// A tag is known by its name, so renaming it means renaming it EVERYWHERE it is: in the Notes, Todos and Boards lists and on
// every note, todo, board and folder that carries it. When the new name is one that already exists (in any capitalisation),
// the two become one: the existing spelling wins, so there are never two tags that differ only by case.
import { cleanTagName, MAX_TAG_LENGTH } from "$lib/utils/tagNames";
import { isSystemTag } from "$lib/utils/systemTags";

export type RenamePlan =
  | { ok: false; message: string }
  /** `name` is what the tag will be called (the existing tag's spelling when `merge`); `same`: nothing to do. */
  | { ok: true; name: string; merge: boolean; same: boolean };

/** What renaming `oldName` to what was typed would do. `existing` is every tag name known now (lists and items). */
export function planRename(oldName: string, typed: string, existing: readonly string[]): RenamePlan {
  if (isSystemTag(oldName)) return { ok: false, message: "Built-in tags can't be renamed." };
  const name = cleanTagName(typed);
  if (!name) return { ok: false, message: typed.trim() === "" ? "Type a tag name." : `Up to ${MAX_TAG_LENGTH} characters.` };
  if (isSystemTag(name)) return { ok: false, message: "That name is built in." };
  if (name === oldName) return { ok: true, name, merge: false, same: true };
  const lower = name.toLowerCase();
  const other = existing.find((t) => t !== oldName && t.toLowerCase() === lower);
  if (other !== undefined) return { ok: true, name: other, merge: true, same: false };
  return { ok: true, name, merge: false, same: false };
}

/** A tag list with `oldName` replaced by `newName`, each tag once, order kept (the renamed tag keeps its place). */
export function renameInTags(tags: readonly string[], oldName: string, newName: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const next = t === oldName ? newName : t;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}
