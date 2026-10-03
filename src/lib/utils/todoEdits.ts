// Round 35 — the pure list edits behind the todo editor's undo, reorder and
// move-to-category. No Svelte, no browser: the route applies the results to
// its $state todo, and everything that can go wrong (positions, the last
// category, an undo after other edits) is decided here where it can be
// tested directly.
//
// A todo's steps live in ONE flat array across all categories
// (`step.category` says which tab shows it), so "move a step up" means "swap
// it with the previous step OF THE SAME CATEGORY", leaving other
// categories' steps exactly where they are.
import type { Annotation, Step } from "$lib/types/entry";

export type Removed<T> = { item: T; index: number };

/** `list` without the entries matching `pred`, plus what was taken out and where it sat. */
export function removeWhere<T>(list: readonly T[], pred: (t: T) => boolean): { list: T[]; removed: Removed<T>[] } {
  const kept: T[] = [];
  const removed: Removed<T>[] = [];
  list.forEach((item, index) => {
    if (pred(item)) removed.push({ item, index });
    else kept.push(item);
  });
  return { list: kept, removed };
}

/**
 * Put removed entries back at their old positions (clamped, in ascending
 * order, so several removals from one list land as they were). Positions are
 * from the moment of removal; if the list changed since, clamping keeps them
 * in range instead of throwing or dropping anything.
 */
export function reinsert<T>(list: readonly T[], removed: readonly Removed<T>[]): T[] {
  const out = [...list];
  for (const r of [...removed].sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(r.index, out.length), 0, r.item);
  }
  return out;
}

/** Which category should be selected after `removed` is deleted. */
export function nextCategoryAfterRemoval(categories: readonly string[], removed: string, current: string): string | null {
  const remaining = categories.filter((c) => c !== removed);
  if (remaining.length === 0) return null;
  if (current !== removed && remaining.includes(current)) return current;
  const at = categories.indexOf(removed);
  // the tab that slides into its place, else the one before it
  return remaining[Math.min(at < 0 ? 0 : at, remaining.length - 1)];
}

export type CategoryRemoval = {
  categories: string[];
  steps: Step[];
  annotations: Annotation[];
  undo: { category: Removed<string>; steps: Removed<Step>[]; annotations: Removed<Annotation>[] };
};

/** Delete a category with its steps and notes. null (nothing changes) when it doesn't exist or is the LAST one — a todo always keeps a category. */
export function removeCategoryFrom(
  todo: { categories: readonly string[]; steps: readonly Step[]; annotations: readonly Annotation[] },
  name: string
): CategoryRemoval | null {
  const index = todo.categories.indexOf(name);
  if (index === -1 || todo.categories.length <= 1) return null;
  const s = removeWhere(todo.steps, (x) => x.category === name);
  const a = removeWhere(todo.annotations, (x) => x.category === name);
  return {
    categories: todo.categories.filter((c) => c !== name),
    steps: s.list,
    annotations: a.list,
    undo: { category: { item: name, index }, steps: s.removed, annotations: a.removed },
  };
}

/** Undo of removeCategoryFrom. If the name was re-created meanwhile it isn't added twice; its steps and notes still come back. */
export function restoreCategory(
  todo: { categories: readonly string[]; steps: readonly Step[]; annotations: readonly Annotation[] },
  undo: CategoryRemoval["undo"]
): { categories: string[]; steps: Step[]; annotations: Annotation[] } {
  const categories = todo.categories.includes(undo.category.item) ? [...todo.categories] : reinsert(todo.categories, [undo.category]);
  return { categories, steps: reinsert(todo.steps, undo.steps), annotations: reinsert(todo.annotations, undo.annotations) };
}

/** Swap the step with its neighbour in the same category (-1 up, +1 down). null at the edge or for an unknown id. */
export function moveWithinCategory(steps: readonly Step[], id: string, dir: -1 | 1): Step[] | null {
  const i = steps.findIndex((s) => s.id === id);
  if (i === -1) return null;
  const category = steps[i].category;
  let j = i + dir;
  while (j >= 0 && j < steps.length && steps[j].category !== category) j += dir;
  if (j < 0 || j >= steps.length) return null;
  const out = [...steps];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Re-file a step under another category, at the END of that category's steps. null for an unknown id or the category it's already in. */
export function moveToCategory(steps: readonly Step[], id: string, category: string): Step[] | null {
  const i = steps.findIndex((s) => s.id === id);
  if (i === -1 || steps[i].category === category) return null;
  const moved: Step = { ...steps[i], category };
  const rest = steps.filter((s) => s.id !== id);
  let last = -1;
  rest.forEach((s, k) => {
    if (s.category === category) last = k;
  });
  rest.splice(last === -1 ? rest.length : last + 1, 0, moved);
  return rest;
}
