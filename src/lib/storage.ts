// TEMPORARY local persistence — localStorage, same as the original
// SimpleNotesAndRecipies app used. This is a placeholder for
// src-tauri/src/data/entries.rs + index.rs, which aren't implemented yet
// (see the TODOs there). Swapping this module's internals for real
// Tauri invoke() calls later shouldn't require touching any component
// that imports from here, since the exported function shapes below are
// what a Tauri-backed version would expose too.
import type { CustomTheme, Entry, Note, Todo } from "$lib/types/entry";
import { NO_THEME } from "$lib/types/entry";

const ENTRIES_KEY = "midnote:entries";
const TAGS_KEY = "midnote:known-tags";
const CUSTOM_THEMES_KEY = "midnote:custom-themes";

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
      // Entries saved before the struck field existed won't have it at
      // all (undefined, not false) — same migration-default treatment
      // as tags/steps/annotations/categories above. isPinned/theme are
      // the two newest fields and get identical treatment.
      if (typeof e.struck !== "boolean") e.struck = false;
      if (typeof e.isPinned !== "boolean") e.isPinned = false;
      if (!e.theme || typeof e.theme !== "object" || typeof e.theme.kind !== "string") e.theme = { ...NO_THEME };
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
    struck: false,
    isPinned: false,
    theme: { ...NO_THEME },
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
    struck: false,
    isPinned: false,
    theme: { ...NO_THEME },
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

// Custom (user-uploaded) theme registry — mirrors custom-themes.mdix's
// custom_theme(id, data, width, height, createdAt) exactly. Kept as its
// own top-level record the same way the schema does: an upload can be
// applied to more than one note, so it's stored once and referenced by
// id (ThemeRef.customThemeId) rather than duplicated onto every entry
// that uses it.
export function loadCustomThemes(): CustomTheme[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("storage: failed to load custom themes, treating as empty:", err);
    return [];
  }
}

function saveCustomThemes(themes: CustomTheme[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

export function deleteCustomTheme(id: string) {
  saveCustomThemes(loadCustomThemes().filter((t) => t.id !== id));
}

// Longest edge a stored theme image is allowed to be. This is a card/
// editor background, never viewed full-screen at native resolution, so
// there's no reason to keep a multi-megabyte original around — every
// uploaded photo gets downscaled to this before it ever touches
// localStorage. Real number, not the schema file's 1080x1920 placeholder
// (that was explicitly "not a recommendation" — this is the actual
// application decision it said still needed making).
const MAX_THEME_EDGE_PX = 720;
const THEME_JPEG_QUALITY = 0.82;

// Browser-only (Image/canvas) — never called during app boot or in the
// smoke test, only from a user-triggered file-input change in
// ThemePicker.svelte, so it's fine for this to have no jsdom-compatible
// path. NOT verified against a real decoded image in this sandbox (no
// real canvas/Image implementation here) — needs real on-device
// confirmation that an actual photo from the device gallery downscales
// and previews correctly.
export function storeCustomThemeImage(file: File): Promise<CustomTheme> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like a valid image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_THEME_EDGE_PX / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Couldn't process that image on this device."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const theme: CustomTheme = {
          id: generateId(),
          data: canvas.toDataURL("image/jpeg", THEME_JPEG_QUALITY),
          width,
          height,
          createdAt: new Date().toISOString(),
        };
        const themes = loadCustomThemes();
        themes.push(theme);
        saveCustomThemes(themes);
        resolve(theme);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
