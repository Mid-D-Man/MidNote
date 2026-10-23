// System tags: built into MidNote, so they are always in the tag lists (the filter chips, the tag picker, Settings ->
// Tags) whether or not anything uses them yet, and can't be removed from those lists.
//
//   AI Generated   put on the notes "Create with AI" files for you
//   Example        on the example folder (and, by inheritance, the example notes, todo and board) of a fresh install
//
// They are NOT stored: the registry the person edits (storage.ts known tags) holds only their own tags, and the system
// ones are merged in when the lists are built (stores/tags.svelte.ts). So there is nothing to migrate, back up or sync,
// and a tag that was already registered by hand under one of these names simply merges with it.
// Plain TypeScript, no Svelte.
import type { TagScope } from "$lib/storage";

export interface SystemTag {
  name: string;
  /** The lists (tabs) the tag is always available in. */
  scopes: readonly TagScope[];
  /** One line for Settings -> Tags. */
  what: string;
}

export const SYSTEM_TAGS: readonly SystemTag[] = [
  { name: "AI Generated", scopes: ["notes"], what: "Put on the notes that Create with AI makes for you." },
  { name: "Example", scopes: ["notes", "todos", "boards"], what: "On the example folder that comes with a fresh install, and so on everything inside it." },
];

/** Is `name` one of the built-in tags (in `scope`, or in any list when no scope is given)? Tag names are case-sensitive. */
export function isSystemTag(name: string, scope?: TagScope): boolean {
  return SYSTEM_TAGS.some((t) => t.name === name && (scope === undefined || t.scopes.includes(scope)));
}

/** The built-in tags that belong in `scope`'s list, in a fixed order. */
export function systemTagsFor(scope: TagScope): string[] {
  return SYSTEM_TAGS.filter((t) => t.scopes.includes(scope)).map((t) => t.name);
}

/** `known` (a person's own tags, as registered) with the built-in ones first; a name is never listed twice. */
export function withSystemTags(scope: TagScope, known: readonly string[]): string[] {
  const system = systemTagsFor(scope);
  return [...system, ...known.filter((t, i) => !system.includes(t) && known.indexOf(t) === i)];
}
