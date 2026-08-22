// Known-tag registry, reactive. Mirrors mdix_files/schema/tags.mdix.
// sync() is called explicitly from +page.svelte after entries.svelte.ts's
// first-run seeding runs, rather than relying on module-evaluation order
// between the two stores to happen to land tags after entries.
import * as storage from "$lib/storage";
import { untrack } from "svelte";

export const noteTags = $state<string[]>([]);
export const todoTags = $state<string[]>([]);

export function sync() {
  // Same defensive fix as entries.svelte.ts's refresh() and
  // log.svelte.ts's addLog() — reads noteTags.length/todoTags.length then
  // writes those same arrays via splice. Currently only ever called from
  // onMount (not a tracked context, so not live today), but untrack here
  // means it stays safe even if a future effect calls it.
  untrack(() => {
    const known = storage.loadKnownTags();
    noteTags.splice(0, noteTags.length, ...known.notes);
    todoTags.splice(0, todoTags.length, ...known.todos);
  });
}

export function registerTag(kind: "notes" | "todos", tag: string) {
  storage.addKnownTag(kind, tag);
  sync();
}

export function unregisterTag(kind: "notes" | "todos", tag: string) {
  storage.removeKnownTag(kind, tag);
  sync();
}
