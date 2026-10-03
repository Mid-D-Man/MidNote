// Round 34 — renaming a todo's sub-category.
//
// Categories are plain strings, and every step and annotation points at its
// category BY NAME (`step.category === "Steps"`). So a rename is three edits
// that must happen together: the `categories` list, every step, and every
// annotation. Doing only the first leaves steps filed under a category that
// no longer exists — they'd vanish from every tab (the tab filters on the
// name) while still sitting in the saved data. This function does all three
// and nothing else, and refuses (touching nothing) when the new name is
// empty, too long or already taken.
//
// "Steps" is just what a new todo's first category is called
// (storage.ts createTodo); nothing treats the name specially, which is why a
// rename needs no special case for it.

export const MAX_CATEGORY_LENGTH = 40;

type Named = { category: string };
export type CategoryOwner = { categories: string[]; steps: Named[]; annotations: Named[] };

export type RenameResult = { ok: true; name: string } | { ok: false; message: string };

/** Trim, collapse runs of whitespace, cap the length. */
export function cleanCategoryName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_CATEGORY_LENGTH ? collapsed.slice(0, MAX_CATEGORY_LENGTH).trim() : collapsed;
}

/**
 * Rename `from` to `rawTo` on `todo`, in place (the route's todo is a Svelte
 * $state proxy, so edits go through it rather than building a copy).
 * Renaming to the same name differing only in case is allowed ("steps" ->
 * "Steps"); renaming onto a DIFFERENT existing category is not, because that
 * would silently merge two tabs.
 */
export function renameCategory(todo: CategoryOwner, from: string, rawTo: string): RenameResult {
  const index = todo.categories.indexOf(from);
  if (index === -1) return { ok: false, message: "That category no longer exists." };
  const to = cleanCategoryName(rawTo);
  if (!to) return { ok: false, message: "Give the category a name." };
  const clash = todo.categories.some((c, i) => i !== index && c.toLowerCase() === to.toLowerCase());
  if (clash) return { ok: false, message: `You already have a category called "${to}".` };
  if (to === from) return { ok: true, name: to };

  todo.categories[index] = to;
  for (const s of todo.steps) if (s.category === from) s.category = to;
  for (const a of todo.annotations) if (a.category === from) a.category = to;
  return { ok: true, name: to };
}
