// Reactive entry list — Svelte 5 runes state. Backed by src/lib/storage.ts
// (localStorage, temporary) rather than notes_index.mdix/todos_index.mdix
// directly; see that file's header for why.
import type { Entry, Note, Todo } from "$lib/types/entry";
import * as storage from "$lib/storage";
import { untrack } from "svelte";

function seedIfEmpty(): Entry[] {
  const loaded = storage.loadEntries();
  if (loaded.length > 0) return loaded;

  const now = new Date().toISOString();
  const sample: Note[] = [
    {
      id: storage.generateId(),
      type: "regular",
      title: "Shopping List",
      content: "Milk, eggs, bread, butter",
      tags: ["Personal"],
      lastModified: now,
      isBookmarked: true,
      encrypted: false,
      struck: false,
    },
    {
      id: storage.generateId(),
      type: "regular",
      title: "Meeting Notes",
      content: "Discussed project timeline and deliverables",
      tags: ["Work"],
      lastModified: now,
      isBookmarked: false,
      encrypted: false,
      struck: false,
    },
  ];
  sample.forEach((n) => {
    storage.upsertEntry(n);
    storage.addKnownTag("notes", n.tags[0]);
  });
  return storage.loadEntries();
}

export const entries = $state<Entry[]>(seedIfEmpty());

export function getNotes(): Note[] {
  return entries.filter((e): e is Note => e.type === "regular");
}

export function getTodos(): Todo[] {
  return entries.filter((e): e is Todo => e.type === "todo");
}

export function refresh() {
  // Not currently called from inside an $effect anywhere in this codebase
  // (verified — saveEntry/removeEntry are only reached from onClick
  // handlers and the visibilitychange/pagehide listeners in the note/todo
  // pages, none of which are tracked contexts). Fixed preemptively anyway:
  // this is the identical read-then-write-same-state shape as the
  // log.svelte.ts bug (reads entries.length, then writes entries via
  // splice), and the most likely next feature on this codebase —
  // autosave-on-content-change via an $effect, replacing the current
  // visibilitychange-only autosave — would call saveEntry() -> refresh()
  // from directly inside an effect and reintroduce this exact bug class.
  untrack(() => {
    entries.splice(0, entries.length, ...storage.loadEntries());
  });
}

export function saveEntry(entry: Entry) {
  storage.upsertEntry(entry);
  refresh();
}

export function removeEntry(id: string) {
  storage.deleteEntry(id);
  refresh();
}

export function toggleBookmark(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.isBookmarked = !entry.isBookmarked;
  saveEntry(entry);
}

export function toggleStrikethrough(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.struck = !entry.struck;
  saveEntry(entry);
}
