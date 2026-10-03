// Reactive entry list — Svelte 5 runes state. Backed by src/lib/storage.ts,
// itself now backed by the real Tauri data layer (entries.rs/index.rs) —
// see that file's header for the async-hydration/sync-API split.
import type { Entry, Note, Todo } from "$lib/types/entry";
import * as storage from "$lib/storage";
import { NO_THEME } from "$lib/types/entry";
import { untrack } from "svelte";
import { cancelReminderSilently, syncReminderSilently, refreshReminderTitle } from "$lib/utils/reminders";

// Starts empty rather than seeded synchronously at module-evaluation
// time (as it did back when storage.ts was pure localStorage) — real
// data can only arrive after an async round trip now, so seeding has to
// wait for that too. See initFromBackend below, and +layout.svelte's
// onMount for where it's actually called from.
export const entries = $state<Entry[]>([]);

// Moved out of a "seedIfEmpty" that used to run synchronously inside the
// $state initializer above — same sample-note behavior, just run once
// storage.initStorage() confirms there's genuinely nothing there yet,
// rather than assumed empty at import time (which, for a real async
// backend, it always would have been on the very first read regardless
// of whether real data existed).
export async function initFromBackend(): Promise<void> {
  await storage.initStorage();
  if (storage.loadEntries().length === 0) {
    seedSamples();
  }
  // Runs once per boot, after real data is in — anything already past
  // Trash's retention window gets removed for real before the list ever
  // renders, rather than waiting for the user to happen to open Trash.
  storage.purgeExpiredTrash();
  refresh();
}

function seedSamples() {
  const now = new Date().toISOString();
  const sample: Note[] = [
    {
      id: storage.generateId(),
      type: "regular",
      title: "Shopping List",
      content: "Milk, eggs, bread, butter",
      pages: [],
      page1Name: null,
      tags: ["Personal"],
      lastModified: now,
      isBookmarked: true,
      encrypted: false,
      struck: false,
      isPinned: false,
      headerTheme: { ...NO_THEME },
      bodyTheme: { ...NO_THEME },
      icon: null,
      lockKeyMode: null,
      lockedPayload: null,
      lockedKeyFile: null,
      deletedAt: null,
      comments: [],
      reminderAt: null,
    },
    {
      id: storage.generateId(),
      type: "regular",
      title: "Meeting Notes",
      content: "Discussed project timeline and deliverables",
      pages: [],
      page1Name: null,
      tags: ["Work"],
      lastModified: now,
      isBookmarked: false,
      encrypted: false,
      struck: false,
      isPinned: false,
      headerTheme: { ...NO_THEME },
      bodyTheme: { ...NO_THEME },
      icon: null,
      lockKeyMode: null,
      lockedPayload: null,
      lockedKeyFile: null,
      deletedAt: null,
      comments: [],
      reminderAt: null,
    },
  ];
  sample.forEach((n) => {
    storage.upsertEntry(n);
    storage.addKnownTag("notes", n.tags[0]);
  });
}

export function getNotes(): Note[] {
  return entries.filter((e): e is Note => e.type === "regular" && !e.deletedAt);
}

export function getTodos(): Todo[] {
  return entries.filter((e): e is Todo => e.type === "todo" && !e.deletedAt);
}

// Everything currently in Trash, any type, newest-deleted first — the
// Trash view's own data source.
export function getTrashed(): Entry[] {
  return entries
    .filter((e) => e.deletedAt)
    .sort((a, b) => (b.deletedAt as string).localeCompare(a.deletedAt as string));
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
  // Round 34: a rename must reach the scheduled notification's title. No-op
  // (and no native call) unless the entry has a reminder whose title changed.
  if (entry.reminderAt) void refreshReminderTitle(entry).catch(() => {});
}

// Soft delete — every existing "Delete" affordance (CardOverflowMenu,
// the three editor headers, +page.svelte's multi-select bar and merge
// cleanup) already calls this one function, so moving to Trash instead
// of a real delete needed no changes anywhere else at all. See
// storage.ts's moveToTrash/TRASH_RETENTION_DAYS.
export function removeEntry(id: string) {
  storage.moveToTrash(id);
  // Round 31: a trashed entry must not go on notifying. The saved
  // `reminderAt` is kept on purpose, so restoring it can bring the reminder back.
  cancelReminderSilently(id);
  refresh();
}

export function restoreEntry(id: string) {
  storage.restoreFromTrash(id);
  refresh();
  const restored = entries.find((e) => e.id === id);
  if (restored) void syncReminderSilently(restored);
}

// The real, permanent delete — only the Trash view's own "Delete
// forever" should ever call this.
export function purgeEntry(id: string) {
  storage.deleteEntry(id);
  cancelReminderSilently(id); // already cancelled at trash time; harmless and makes this path safe on its own
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

export function togglePinned(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.isPinned = !entry.isPinned;
  saveEntry(entry);
}

// NOTE: no store-level setEntryTheme() here (unlike togglePinned/
// toggleBookmark/toggleStrikethrough above) — per-entry theme is only
// ever changed from inside the note/todo editor, where the entry being
// edited is that page's own local $state object (see
// /note/[id]/+page.svelte), not this store's `entries` array. A
// version of this function lived here briefly and looked correct
// (typechecked, ran without error) but silently mutated the wrong
// object — confirmed on-device as "theme doesn't work" for notes/
// todos. NoteEditorHeader/TodoHeader now mutate their own local
// note.headerTheme/note.bodyTheme (and the todo equivalents) directly
// and call saveEntry() themselves. If a
// future screen needs to set an entry's theme from OUTSIDE its own
// editor (operating on a genuine `entries` array item), it's safe to
// add a function like this back — just for that caller, matching the
// pattern toggleBookmark/togglePinned already use correctly from the
// list view.
