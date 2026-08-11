// Known-tag registry, reactive. Mirrors mdix_files/schema/tags.mdix.
// sync() is called explicitly from +page.svelte after entries.svelte.ts's
// first-run seeding runs, rather than relying on module-evaluation order
// between the two stores to happen to land tags after entries.
import * as storage from "$lib/storage";

export const noteTags = $state<string[]>([]);
export const todoTags = $state<string[]>([]);

export function sync() {
  const known = storage.loadKnownTags();
  noteTags.splice(0, noteTags.length, ...known.notes);
  todoTags.splice(0, todoTags.length, ...known.todos);
}

export function registerTag(kind: "notes" | "todos", tag: string) {
  storage.addKnownTag(kind, tag);
  sync();
}

export function unregisterTag(kind: "notes" | "todos", tag: string) {
  storage.removeKnownTag(kind, tag);
  sync();
}
