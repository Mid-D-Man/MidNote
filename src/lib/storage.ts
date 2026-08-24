// TEMPORARY local persistence — localStorage, same as the original
// SimpleNotesAndRecipies app used. This is a placeholder for
// src-tauri/src/data/entries.rs + index.rs, which aren't implemented yet
// (see the TODOs there). Swapping this module's internals for real
// Tauri invoke() calls later shouldn't require touching any component
// that imports from here, since the exported function shapes below are
// what a Tauri-backed version would expose too.
import type { Entry, Note, Todo } from "$lib/types/entry";

const ENTRIES_KEY = "midnote:entries";
const TAGS_KEY = "midnote:known-tags";

export function generateId(): string {
  return crypto.randomUUID();
}

export function loadEntries(): Entry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("storage: entries in localStorage isn't an array, ignoring:", parsed);
      return [];
    }
    // Defensive per-entry validation — a todo saved by an earlier build
    // during testing (different shape) shouldn't be able to crash the
    // whole list read, just get skipped and logged instead.
    const valid: Entry[] = [];
    for (const e of parsed) {
      if (!e || typeof e !== "object" || !e.id || !e.type) {
        console.error("storage: skipping malformed entry:", e);
        continue;
      }
      if (e.type === "todo") {
        if (!Array.isArray(e.steps)) e.steps = [];
        if (!Array.isArray(e.annotations)) e.annotations = [];
        if (!Array.isArray(e.categories) || e.categories.length === 0) e.categories = ["Steps"];
      }
      if (!Array.isArray(e.tags)) e.tags = [];
      valid.push(e);
    }
    return valid;
  } catch (err) {
    console.error("storage: failed to load entries, treating as empty:", err);
    return [];
  }
}

function saveEntries(entries: Entry[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}

export function getEntry(id: string): Entry | undefined {
  return loadEntries().find((e) => e.id === id);
}

export function upsertEntry(entry: Entry) {
  const entries = loadEntries();
  const i = entries.findIndex((e) => e.id === entry.id);
  entry.lastModified = new Date().toISOString();
  if (i === -1) entries.push(entry);
  else entries[i] = entry;
  saveEntries(entries);
}

export function deleteEntry(id: string) {
  saveEntries(loadEntries().filter((e) => e.id !== id));
}

export function createNote(): Note {
  return {
    id: generateId(),
    type: "regular",
    title: "",
    // Not truly empty — a single empty <div> — so the very first line
    // is structurally consistent with every subsequent Enter-created
    // line (also a <div>). Matters for the ruled-lines feature: each
    // line's rule attaches to its own <div>'s border-bottom, and
    // without this the first line would be the one exception with
    // nothing to attach a rule to. See NoteContent.svelte.
    content: "<div><br></div>",
    tags: [],
    lastModified: new Date().toISOString(),
    isBookmarked: false,
    encrypted: false,
  };
}

export function createTodo(): Todo {
  return {
    id: generateId(),
    type: "todo",
    title: "",
    tags: [],
    lastModified: new Date().toISOString(),
    isBookmarked: false,
    encrypted: false,
    categories: ["Steps"],
    steps: [],
    annotations: [],
  };
}

// Known-tag registry — mirrors mdix_files/schema/tags.mdix's
// notes:: / todos:: split.
interface KnownTags {
  notes: string[];
  todos: string[];
}

export function loadKnownTags(): KnownTags {
  if (typeof localStorage === "undefined") return { notes: [], todos: [] };
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    return raw ? (JSON.parse(raw) as KnownTags) : { notes: [], todos: [] };
  } catch {
    return { notes: [], todos: [] };
  }
}

export function addKnownTag(kind: "notes" | "todos", tag: string) {
  if (typeof localStorage === "undefined") return;
  const known = loadKnownTags();
  if (!known[kind].includes(tag)) {
    known[kind].push(tag);
    localStorage.setItem(TAGS_KEY, JSON.stringify(known));
  }
}

export function removeKnownTag(kind: "notes" | "todos", tag: string) {
  if (typeof localStorage === "undefined") return;
  const known = loadKnownTags();
  known[kind] = known[kind].filter((t) => t !== tag);
  localStorage.setItem(TAGS_KEY, JSON.stringify(known));
}
