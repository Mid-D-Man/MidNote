// Real persistence: src-tauri/src/data/entries.rs (per-entry .mdix
// files), index.rs (notes_index.mdix/todos_index.mdix/boards_index.mdix)
// and tags.rs (tags.mdix), via the Tauri commands wrapped in
// $lib/dixscript/client.ts. Every exported function below keeps the
// EXACT same synchronous signature it had when this file was pure
// localStorage — see initStorage()'s own comment for how that's possible
// despite the real backend being async.
//
// DEV/TEST FALLBACK: dix.isTauriRuntime() is false in a plain browser tab
// and in this project's own jsdom-based smoke-test harness (scripts/
// smoke-test.mjs) — neither has Tauri's own JS bridge. In both cases
// this file falls back to the exact same localStorage behavior it always
// used, so `npm run smoke` and any future desktop-browser dev workflow
// keep working without ever calling a real invoke(). This is a real
// technical necessity, not related to CLAUDEcode's separate decision
// that existing on-device localStorage data doesn't need migrating —
// that decision only affects what happens the first time this ships to
// a real device; it doesn't touch the fallback path, which exists purely
// so this file still works somewhere with no Tauri runtime under it.
import type { Board, CustomIcon, CustomTheme, Entry, EntryComment, Note, Todo } from "$lib/types/entry";
import { NO_THEME } from "$lib/types/entry";
import { getColorSync } from "colorthief";
import * as dix from "$lib/dixscript/client";
import { breadcrumb } from "$lib/debug/log.svelte";
import { sanitizeComments, reconcileCommentPages } from "$lib/utils/comments";

const ENTRIES_KEY = "midnote:entries";
const TAGS_KEY = "midnote:known-tags";
const CUSTOM_THEMES_KEY = "midnote:custom-themes";
const CUSTOM_ICONS_KEY = "midnote:custom-icons";

export function generateId(): string {
  return crypto.randomUUID();
}

// BUGFIX (round 24): a real, confirmed on-device crash — every save of a
// note or board threw `DataCloneError: ... could not be cloned` (todo
// saves would have hit the exact same thing, just not yet exercised in
// the report). Root cause: upsertEntry's `entry` argument here isn't a
// plain object — it's the live Svelte 5 `$state` reactive proxy from
// whichever editor route called saveEntry (note/[id]/+page.svelte's
// `note`, board/[id]/+page.svelte's `board`, etc.), and structuredClone's
// clone algorithm can't traverse Svelte 5's reactive proxy wrapping (it
// isn't a plain object/array/Map/Set/Date/etc. as far as the algorithm's
// own type checks are concerned) — confirmed by the crash reaching this
// same code from BOTH an explicit Save button AND BoardHeader's silent
// per-keystroke onPersist on the title field, i.e. from every call site
// that ever hands a live $state object to storage.ts, not something
// specific to one button. `$state.snapshot()` (the Svelte-provided fix
// for exactly this) isn't usable here — it's a compiler rune, only
// available inside .svelte/.svelte.ts files, and storage.ts is a plain
// .ts file the Svelte compiler doesn't touch. A JSON round-trip sidesteps
// the whole problem instead: JSON.stringify walks a Proxy via normal
// property access (which Svelte's reactive proxies fully support — it's
// how the app already reads every field of `entry` to build the very
// JSON string sent to the real backend a few lines below), producing a
// string with zero proxy involvement, and JSON.parse turns that back
// into a genuinely plain object. This is also a more honest clone for
// this specific use than structuredClone ever was: everything this app
// stores is already constrained to JSON-safe shapes (that's the whole
// premise `dix.saveEntry`'s `JSON.stringify(entry)` call already rested
// on) — structuredClone's extra support for Dates/Maps/Sets was never
// actually being used or needed here.
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---- Entries ----
// In-memory cache backing loadEntries()/getEntry() below. Populated once
// by initStorage(); every read/write function here operates on this
// directly rather than re-fetching, since a real invoke() round trip
// can't happen inside a function that has to stay synchronous.
let _entries: Entry[] = [];
let _entriesInitialized = false;

// Defensive per-entry validation — factored out of the old loadEntries()
// so both the real-backend path and the localStorage fallback path run
// it, since either can hand back an entry saved under an older shape (a
// real .mdix file written by a future version of this same code, same as
// an old localStorage record could be).
function normalizeEntry(e: unknown): Entry | null {
  const entry = e as Record<string, unknown> & { pages?: Array<Record<string, unknown>> };
  if (!entry || typeof entry !== "object" || !entry.id || !entry.type) {
    console.error("storage: skipping malformed entry:", entry);
    return null;
  }
  if (entry.type === "todo") {
    if (!Array.isArray(entry.steps)) entry.steps = [];
    // Round 36: every step carries a boolean `done`. Old entries (and the odd
    // hand-edited one) lack it or hold something else; only a real `true` counts.
    entry.steps = (entry.steps as Array<Record<string, unknown>>).map((s) => ({ ...s, done: s?.done === true }));
    if (!Array.isArray(entry.annotations)) entry.annotations = [];
    if (!Array.isArray(entry.categories) || (entry.categories as unknown[]).length === 0) entry.categories = ["Steps"];
  }
  if (entry.type === "board") {
    if (!Array.isArray(entry.nodes)) entry.nodes = [];
    if (!Array.isArray(entry.edges)) entry.edges = [];
    // Round 38: every connection carries a caption (or null) and an arrow flag.
    entry.edges = (entry.edges as Array<Record<string, unknown>>).map((e) => ({
      ...e,
      label: typeof e?.label === "string" && e.label.trim() ? e.label : null,
      directed: e?.directed === true,
    }));
    const viewport = entry.viewport as { zoom?: unknown } | null | undefined;
    if (!viewport || typeof viewport.zoom !== "number") entry.viewport = null;
  }
  if (!Array.isArray(entry.tags)) entry.tags = [];
  if (typeof entry.struck !== "boolean") entry.struck = false;
  if (typeof entry.isPinned !== "boolean") entry.isPinned = false;
  const isValidThemeRef = (t: unknown): t is { kind: string } => !!t && typeof t === "object" && typeof (t as { kind?: unknown }).kind === "string";
  if (!isValidThemeRef(entry.headerTheme)) {
    entry.headerTheme = isValidThemeRef(entry.theme) ? entry.theme : { ...NO_THEME };
  }
  if (!isValidThemeRef(entry.bodyTheme)) entry.bodyTheme = { ...NO_THEME };
  if (typeof entry.icon === "string") {
    entry.icon = { kind: "preset", name: entry.icon };
  } else if (!entry.icon || typeof entry.icon !== "object" || ((entry.icon as { kind?: unknown }).kind !== "preset" && (entry.icon as { kind?: unknown }).kind !== "custom")) {
    entry.icon = null;
  }
  if (entry.lockKeyMode !== "app" && entry.lockKeyMode !== "custom") entry.lockKeyMode = null;
  if (typeof entry.lockedPayload !== "string") entry.lockedPayload = null;
  if (typeof entry.lockedKeyFile !== "string") entry.lockedKeyFile = null;
  if (typeof entry.deletedAt !== "string") entry.deletedAt = null;
  // Round 31: reminder time. Anything that isn't a parseable date is dropped.
  if (typeof entry.reminderAt !== "string" || Number.isNaN(Date.parse(entry.reminderAt))) entry.reminderAt = null;
  // Round 30: comments. Older entries have no field; sanitize also drops junk.
  entry.comments = sanitizeComments(entry.comments, generateId);
  if (entry.type === "regular" && !Array.isArray(entry.pages)) entry.pages = [];
  // Round 39: a note's comments belong to a page; any that point at a page that
  // is gone (a hand-edited file, an interrupted page delete) move to page 1.
  if (entry.type === "regular") entry.comments = reconcileCommentPages(entry.comments as EntryComment[], (entry.pages as Array<{ id: string }>).map((p) => p.id));
  if (entry.type === "regular") {
    if (typeof entry.page1Name !== "string") entry.page1Name = null;
    for (const p of entry.pages ?? []) {
      if (typeof p.name !== "string") p.name = null;
    }
  }
  return entry as unknown as Entry;
}

function normalizeEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) {
    console.error("storage: entries payload isn't an array, ignoring:", raw);
    return [];
  }
  const valid: Entry[] = [];
  for (const e of raw) {
    const n = normalizeEntry(e);
    if (n) valid.push(n);
  }
  return valid;
}

function loadEntriesFromLocalStorage(): Entry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    if (!raw) return [];
    return normalizeEntries(JSON.parse(raw));
  } catch (err) {
    console.error("storage: failed to load entries, treating as empty:", err);
    return [];
  }
}

function saveEntriesToLocalStorage(entries: Entry[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}

// ---- Tags ----
interface KnownTags {
  notes: string[];
  todos: string[];
  boards: string[];
}

export type TagScope = keyof KnownTags;

let _knownTags: KnownTags = { notes: [], todos: [], boards: [] };

function parseKnownTags(raw: unknown): KnownTags {
  const parsed = (raw ?? {}) as Partial<KnownTags>;
  return { notes: parsed.notes ?? [], todos: parsed.todos ?? [], boards: parsed.boards ?? [] };
}

function loadKnownTagsFromLocalStorage(): KnownTags {
  if (typeof localStorage === "undefined") return { notes: [], todos: [], boards: [] };
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    return parseKnownTags(raw ? JSON.parse(raw) : {});
  } catch {
    return { notes: [], todos: [], boards: [] };
  }
}

function saveKnownTagsToLocalStorage(tags: KnownTags) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
}

// ---- One-time async hydration ----
// MUST be awaited (see routes/+layout.svelte's onMount) before anything
// reads loadEntries()/loadKnownTags() for real. Safe to call more than
// once — every call after the first returns the same in-flight/completed
// promise rather than re-fetching.
let _initPromise: Promise<void> | null = null;

export function initStorage(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (dix.isTauriRuntime()) {
      try {
        const [entriesJson, tagsJson] = await Promise.all([dix.getAllEntries(), dix.getTags()]);
        _entries = normalizeEntries(JSON.parse(entriesJson));
        _knownTags = parseKnownTags(JSON.parse(tagsJson));
      } catch (err) {
        console.error("storage: failed to load from the real backend, starting empty:", err);
        _entries = [];
        _knownTags = { notes: [], todos: [], boards: [] };
      }
    } else {
      // Plain browser tab / smoke-test harness — no real Tauri bridge to
      // call. Same behavior this file always had.
      _entries = loadEntriesFromLocalStorage();
      _knownTags = loadKnownTagsFromLocalStorage();
    }
    _entriesInitialized = true;
  })();
  return _initPromise;
}

export function loadEntries(): Entry[] {
  if (!_entriesInitialized) {
    // Called before initStorage() resolved — a bug in whatever called it
    // (see +layout.svelte's onMount), not a case to silently paper over
    // with a stale read. Logged once; returns empty rather than
    // throwing, so a stray early read degrades to "nothing yet" instead
    // of crashing its caller.
    console.error("storage: loadEntries() called before initStorage() resolved");
  }
  // Same "always a fresh copy, never the live cache" contract the
  // localStorage-era version had (parsing JSON fresh on every call) — a
  // caller mutating what it got back must never affect canonical state
  // without going through upsertEntry.
  return clone(_entries);
}

export function getEntry(id: string): Entry | undefined {
  return loadEntries().find((e) => e.id === id);
}

export function upsertEntry(entry: Entry) {
  entry.lastModified = new Date().toISOString();
  const stored = clone(entry);
  const i = _entries.findIndex((e) => e.id === entry.id);
  if (i === -1) _entries.push(stored);
  else _entries[i] = stored;

  if (dix.isTauriRuntime()) {
    // Fire-and-persist: the in-memory cache above (the UI's actual
    // source of truth) is already updated synchronously, so the caller
    // never waits on this — matching this function's pre-existing
    // synchronous signature. A failure here is logged, not surfaced to
    // the caller; the in-memory state the UI reads from stays correct
    // either way, at the cost of that one change not surviving an app
    // kill before this resolves. See this project's data-layer notes
    // for that trade-off stated plainly, not left implicit.
    // Timed (round 27 diagnostics): the Rust side re-reads every entry
    // from disk to rebuild the index on each save, in a DEBUG build on
    // the test phone — so a very large note could make THIS, not the
    // editor, the slow part of "paste, then save". Logged when the
    // payload is big or the round trip is slow, to settle that with a
    // number instead of a guess.
    const payload = JSON.stringify(entry);
    const t0 = performance.now();
    dix
      .saveEntry(entry.id, payload)
      .then(() => {
        const ms = performance.now() - t0;
        if (payload.length >= 50_000 || ms >= 500) {
          breadcrumb(`storage: save_entry (${entry.type}) ${Math.round(payload.length / 1024)}KB round trip ${Math.round(ms)}ms`);
        }
      })
      .catch((err) => {
        console.error(`storage: failed to persist entry ${entry.id} to the real backend:`, err);
      });
  } else {
    saveEntriesToLocalStorage(_entries);
  }
}

// The REAL, permanent delete — removes the file (or localStorage record)
// outright. Only two callers should ever reach this: purgeExpiredTrash
// below (an item's been sitting in Trash past the retention window) and
// the Trash view's own explicit "Delete forever" action. Every ordinary
// "Delete" a user taps from CardOverflowMenu or an editor header goes
// through entries.svelte.ts's removeEntry(), which calls moveToTrash
// below instead — this function was already the single implementation
// backing all of those before Trash existed, so nothing about ITS OWN
// behavior needed to change; only what calls it did.
export function deleteEntry(id: string) {
  _entries = _entries.filter((e) => e.id !== id);
  if (dix.isTauriRuntime()) {
    dix.deleteEntry(id).catch((err) => {
      console.error(`storage: failed to delete entry ${id} from the real backend:`, err);
    });
  } else {
    saveEntriesToLocalStorage(_entries);
  }
}

// Soft delete — sets deletedAt and persists through the exact same
// upsertEntry() path a normal edit does (no separate Rust/backend
// command needed: a trashed entry is still a fully saved entry, just
// one the UI now filters out of the regular note/todo/board lists — see
// entries.svelte.ts's getNotes/getTodos and +page.svelte's `boards`
// derivation).
export function moveToTrash(id: string) {
  const entry = _entries.find((e) => e.id === id);
  if (!entry) return;
  entry.deletedAt = new Date().toISOString();
  upsertEntry(entry);
}

export function restoreFromTrash(id: string) {
  const entry = _entries.find((e) => e.id === id);
  if (!entry) return;
  entry.deletedAt = null;
  upsertEntry(entry);
}

// How long a trashed item survives before purgeExpiredTrash below
// removes it for real — same order of magnitude as every mainstream
// notes/files app's own trash retention (Notion, Google Drive, Apple
// Notes all use 30 days), not a number specific to anything about this
// app's own data.
const TRASH_RETENTION_DAYS = 30;

// Called once per app boot (see entries.svelte.ts's initFromBackend) —
// a real, permanent, unattended cleanup, so it deliberately only ever
// acts on entries already past the stated retention window; there's no
// separate "are you sure" for this one since the user already got that
// prompt when the retention window's original promise was made (the
// Trash UI's own copy states the window up front).
export function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = _entries.filter((e) => e.deletedAt && new Date(e.deletedAt).getTime() < cutoff);
  for (const entry of expired) deleteEntry(entry.id);
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
    pages: [],
    page1Name: null,
    tags: [],
    lastModified: new Date().toISOString(),
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
    reminderAt: null,
    comments: [],
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
    headerTheme: { ...NO_THEME },
    bodyTheme: { ...NO_THEME },
    icon: null,
    lockKeyMode: null,
    lockedPayload: null,
    lockedKeyFile: null,
    deletedAt: null,
    reminderAt: null,
    comments: [],
    categories: ["Steps"],
    steps: [],
    annotations: [],
  };
}

export function createBoard(): Board {
  return {
    id: generateId(),
    type: "board",
    title: "",
    tags: [],
    lastModified: new Date().toISOString(),
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
    reminderAt: null,
    comments: [],
    nodes: [],
    edges: [],
    viewport: null,
  };
}

// Known-tag registry — mirrors mdix_files/schema/tags.mdix's
// notes:: / todos:: split, now with a third boards:: scope.
function persistKnownTags() {
  if (dix.isTauriRuntime()) {
    dix.saveTags(JSON.stringify(_knownTags)).catch((err) => {
      console.error("storage: failed to persist tags to the real backend:", err);
    });
  } else {
    saveKnownTagsToLocalStorage(_knownTags);
  }
}

export function loadKnownTags(): KnownTags {
  return clone(_knownTags);
}

export function addKnownTag(kind: TagScope, tag: string) {
  if (!_knownTags[kind].includes(tag)) {
    _knownTags[kind].push(tag);
    persistKnownTags();
  }
}

export function removeKnownTag(kind: TagScope, tag: string) {
  _knownTags[kind] = _knownTags[kind].filter((t) => t !== tag);
  persistKnownTags();
}

// Custom (user-uploaded) theme registry — mirrors custom-themes.mdix's
// custom_theme(id, data, width, height, createdAt) exactly. Kept as its
// own top-level record the same way the schema does: an upload can be
// applied to more than one note, so it's stored once and referenced by
// id (ThemeRef.customThemeId) rather than duplicated onto every entry
// that uses it.
//
// Round 43: these no longer LIVE in localStorage. They hold full base64 image
// blobs (up to ~720px JPEG / 128px PNG) and localStorage's ~5 MB budget is
// shared with every note, so a few themes could make note saves fail. They are
// kept in IndexedDB now (utils/mediaDb.ts, utils/mediaCollection.ts,
// stores/customThemes.svelte.ts). What remains here is only the OLD
// localStorage list: read once to migrate it, and used as the fallback when
// IndexedDB isn't available.
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

export function saveCustomThemes(themes: CustomTheme[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
}

/** Forget the old localStorage list — only after it has been verifiably moved to IndexedDB. */
export function clearLegacyCustomThemes() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(CUSTOM_THEMES_KEY);
}

// Longest edge a stored theme image is allowed to be. This is a card/
// editor background, never viewed full-screen at native resolution, so
// there's no reason to keep a multi-megabyte original around — every
// uploaded photo gets downscaled to this before it is ever
// stored. Real number, not the schema file's 1080x1920 placeholder
// (that was explicitly "not a recommendation" — this is the actual
// application decision it said still needed making).
const MAX_THEME_EDGE_PX = 720;
const THEME_JPEG_QUALITY = 0.82;

// Round 43: this only DECODES, downscales and analyses the photo — it no longer
// saves it. The caller (stores/customThemes.svelte.ts -> MediaCollection.add)
// stores the returned theme, so a failed save can be reported properly.
//
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
        // Contrast text color, computed once here rather than on every
        // render — see CustomTheme.textColor's comment for why it can't
        // be done lazily in resolveTheme instead (image decode is
        // inherently async; resolveTheme is called from synchronous
        // $derived expressions all over the app). The canvas above
        // already has the fully-decoded, already-downscaled image drawn
        // into it for the JPEG re-encode step, so colorthief reads
        // directly off THAT — no second decode, no extra cost. Wrapped
        // in try/catch because canvas pixel reads can fail on some
        // browser/security configurations; if it does, textColor stays
        // undefined and resolveTheme's own fallback ("#ffffff") takes
        // over, matching this image's pre-existing always-light-text
        // behavior rather than the upload failing outright over a
        // cosmetic-only feature.
        let textColor: string | undefined;
        try {
          textColor = getColorSync(canvas)?.textColor;
        } catch (err) {
          console.error("storeCustomThemeImage: colorthief sampling failed, falling back to default text color:", err);
        }
        const theme: CustomTheme = {
          id: generateId(),
          data: canvas.toDataURL("image/jpeg", THEME_JPEG_QUALITY),
          width,
          height,
          createdAt: new Date().toISOString(),
          textColor,
        };
        resolve(theme);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Custom (user-uploaded) icon registry — same "own top-level record,
// referenced by id" shape as loadCustomThemes above, for the same
// reason: one upload can be used as more than one note/todo's icon
// badge, so it's stored once (IconRef.customIconId) rather than
// duplicated onto every entry that uses it. Same round-43 move to
// IndexedDB as loadCustomThemes above (this is only the old list).
export function loadCustomIcons(): CustomIcon[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_ICONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("storage: failed to load custom icons, treating as empty:", err);
    return [];
  }
}

export function saveCustomIcons(icons: CustomIcon[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_ICONS_KEY, JSON.stringify(icons));
}

/** Forget the old localStorage list — only after it has been verifiably moved to IndexedDB. */
export function clearLegacyCustomIcons() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(CUSTOM_ICONS_KEY);
}

// Longest edge a stored icon image is allowed to be — this is a tiny
// badge (NoteCard/the todo row render it at 22px — see NoteCard.svelte's
// .icon-badge), never viewed any larger, so it needs nowhere near a
// theme image's 720px (MAX_THEME_EDGE_PX above). 128px covers even a
// 3x-density display's real pixel size with headroom to spare.
//
// MAX_ICON_SOURCE_BYTES rejects the SOURCE file outright above this size
// rather than attempting to decode it at all — not because a bigger
// photo couldn't be downscaled just as easily as a theme image is, but
// because there's no reason a tiny badge upload should ever need to
// decode a genuinely huge file; this exists to catch an accidental
// multi-hundred-MB selection (or a non-image file with an image-sounding
// name) before spending any real work on it. Anything under this limit
// is always accepted and simply scaled down to size — never rejected
// for being "too big" once it's through this one gate.
const MAX_ICON_EDGE_PX = 128;
const MAX_ICON_SOURCE_BYTES = 8 * 1024 * 1024;

// Like storeCustomThemeImage above (round 43) this only builds the icon; the
// caller stores it. Same browser-only/not-verified-against-a-real-decoded-image
// caveat as storeCustomThemeImage above. Two real differences from that function,
// both deliberate: output is PNG, not JPEG — an icon badge is small
// enough that file size barely matters, and it may well have a
// transparent background (a logo, a sticker) worth actually preserving.
// And the source is center-cropped to a square before downscaling —
// every icon preset glyph, and every swatch in every picker this app
// already has, is circular, so a non-square upload gets cropped
// consistently with everything around it instead of squashed to fit.
export function storeCustomIconImage(file: File): Promise<CustomIcon> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ICON_SOURCE_BYTES) {
      const limitMb = MAX_ICON_SOURCE_BYTES / (1024 * 1024);
      reject(new Error(`That file's too large (${Math.round(file.size / (1024 * 1024))}MB) — try something under ${limitMb}MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like a valid image."));
      img.onload = () => {
        const srcEdge = Math.min(img.width, img.height);
        const srcX = (img.width - srcEdge) / 2;
        const srcY = (img.height - srcEdge) / 2;
        const outEdge = Math.min(MAX_ICON_EDGE_PX, srcEdge);
        const canvas = document.createElement("canvas");
        canvas.width = outEdge;
        canvas.height = outEdge;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Couldn't process that image on this device."));
          return;
        }
        ctx.drawImage(img, srcX, srcY, srcEdge, srcEdge, 0, 0, outEdge, outEdge);
        const icon: CustomIcon = {
          id: generateId(),
          data: canvas.toDataURL("image/png"),
          createdAt: new Date().toISOString(),
        };
        resolve(icon);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
