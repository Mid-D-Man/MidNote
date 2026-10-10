// Round 45 — Backup and Restore: ONE file with everything the user has made.
//
// WHAT IS IN IT: every note, todo and board (including the ones in Trash, and
// locked ones — those stay locked: their encrypted payload is saved as it is),
// the known tags, the uploaded theme backgrounds and icon badges, the imported
// fonts (the font files themselves) and the look-and-feel settings.
//
// WHY: fonts, themes and icons live only on this phone (IndexedDB). A reinstall
// or a new phone would lose them. The file is plain JSON — readable, and easy to
// carry — and is NOT encrypted: anyone who has it can read the unlocked notes.
//
// RESTORE IS A MERGE, never a wipe. Nothing already on the phone is deleted:
//   notes/todos/boards  same id: the NEWER one (by last-modified) wins, otherwise
//                       the one on the phone is kept; ids not on the phone are added
//   themes, icons       added when their id isn't here
//   fonts               added when neither the id nor the name is here
//   tags                added
//   settings            applied (the backup's look-and-feel replaces the phone's)
//
// Plain TypeScript with the app's stores injected (BackupSource / RestoreSink),
// so all of it can be exercised in Node.
import type { CustomIcon, CustomTheme, Entry } from "$lib/types/entry";

export const BACKUP_APP = "midnote-backup";
export const BACKUP_FORMAT = 1;

/** The look-and-feel settings carried in a backup (localStorage keys). Everything else — the debug panel, the last open tab, ... — stays per device. */
export const BACKUP_SETTING_KEYS: readonly string[] = [
  "midnote:app-theme",
  "midnote:app-header-theme",
  "midnote:app-body-theme",
  "midnote:note-lines",
  "midnote:list-view",
  "midnote:font-size",
  "midnote:note-font",
  "midnote:tts",
];

export interface BackupFont {
  id: string;
  name: string;
  kind: string;
  size: number;
  addedAt: string;
  /** The font file, base64. */
  data: string;
}

export interface BackupCounts {
  notes: number;
  todos: number;
  boards: number;
  trashed: number;
  themes: number;
  icons: number;
  fonts: number;
}

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  createdAt: string;
  counts: BackupCounts;
  entries: unknown[];
  tags: { notes: string[]; todos: string[]; boards: string[] };
  themes: CustomTheme[];
  icons: CustomIcon[];
  fonts: BackupFont[];
  settings: Record<string, string>;
}

/** A font as the font library stores it. */
export interface BackupSourceFont {
  id: string;
  name: string;
  kind: string;
  size: number;
  addedAt: string;
  bytes: ArrayBuffer;
}

export interface BackupSource {
  entries(): Entry[];
  tags(): { notes: string[]; todos: string[]; boards: string[] };
  themes(): CustomTheme[];
  icons(): CustomIcon[];
  fonts(): Promise<BackupSourceFont[]>;
  /** localStorage-style read: the raw string, or null. */
  setting(key: string): string | null;
}

// ------------------------------------------------------------------ base64

// A small self-contained base64 codec instead of atob/btoa: no dependence on what the
// environment's atob accepts, no giant argument lists for String.fromCharCode, and a clear
// error for bad input. Checked against Node's Buffer in the tests.
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) t[B64_CHARS.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  const BLOCK = 3 * 0x4000; // bytes per piece of output
  const pieces: string[] = [];
  for (let start = 0; start < bytes.length; start += BLOCK) {
    const end = Math.min(bytes.length, start + BLOCK);
    let s = "";
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
    }
    if (end - i === 1) {
      const n = bytes[i] << 16;
      s += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + "==";
    } else if (end - i === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      s += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + "=";
    }
    pieces.push(s);
  }
  return pieces.join("");
}

/** Throws an Error for anything that isn't valid base64 (whitespace is ignored). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s]/g, "").replace(/={1,2}$/, "");
  if (clean.length % 4 === 1) throw new Error("not valid base64");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? B64_LOOKUP[code] : -1;
    if (v < 0) throw new Error("not valid base64");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

// ------------------------------------------------------------------ building

const pad = (n: number) => String(n).padStart(2, "0");

/** midnote-backup-2026-10-09-1430.json (local time) */
export function backupFileName(now: Date = new Date()): string {
  return `midnote-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

export function countEntries(entries: ReadonlyArray<{ type?: unknown; deletedAt?: unknown }>): Pick<BackupCounts, "notes" | "todos" | "boards" | "trashed"> {
  const c = { notes: 0, todos: 0, boards: 0, trashed: 0 };
  for (const e of entries) {
    if (e.deletedAt) c.trashed++;
    else if (e.type === "regular") c.notes++;
    else if (e.type === "todo") c.todos++;
    else if (e.type === "board") c.boards++;
  }
  return c;
}

export async function buildBackup(src: BackupSource, now: Date = new Date()): Promise<BackupFile> {
  const entries = src.entries();
  const fonts = await src.fonts();
  const settings: Record<string, string> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const v = src.setting(key);
    if (typeof v === "string") settings[key] = v;
  }
  const themes = src.themes();
  const icons = src.icons();
  const tags = src.tags();
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    counts: { ...countEntries(entries), themes: themes.length, icons: icons.length, fonts: fonts.length },
    entries,
    tags: { notes: [...tags.notes], todos: [...tags.todos], boards: [...tags.boards] },
    themes: [...themes],
    icons: [...icons],
    fonts: fonts.map((f) => ({ id: f.id, name: f.name, kind: f.kind, size: f.size, addedAt: f.addedAt, data: bytesToBase64(new Uint8Array(f.bytes)) })),
    settings,
  };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file);
}

// ------------------------------------------------------------------ reading

export type ParseResult = { ok: true; backup: BackupFile } | { ok: false; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => isStr(x) && x.trim() !== "") : [];
}

/** Reads and sanity-checks a backup file's text. Anything malformed inside is dropped, not trusted. */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file isn't a MidNote backup (it isn't readable JSON)." };
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) return { ok: false, message: "That file isn't a MidNote backup." };
  if (typeof raw.format !== "number" || !Number.isFinite(raw.format) || raw.format < 1) {
    return { ok: false, message: "That backup has no version, so it can't be read safely." };
  }
  if (raw.format > BACKUP_FORMAT) {
    return { ok: false, message: "That backup was made by a newer version of MidNote. Update the app, then try again." };
  }

  const entries = Array.isArray(raw.entries) ? raw.entries.filter((e) => isObj(e) && isStr(e.id) && e.id !== "" && isStr(e.type)) : [];
  const themes = (Array.isArray(raw.themes) ? raw.themes : []).filter((t): t is CustomTheme => isObj(t) && isStr(t.id) && isStr(t.data)) as CustomTheme[];
  const icons = (Array.isArray(raw.icons) ? raw.icons : []).filter((i): i is CustomIcon => isObj(i) && isStr(i.id) && isStr(i.data)) as CustomIcon[];
  const fonts = (Array.isArray(raw.fonts) ? raw.fonts : [])
    .filter((f): f is Record<string, unknown> => isObj(f) && isStr(f.id) && isStr(f.name) && isStr(f.data) && f.data !== "")
    .map((f) => ({
      id: f.id as string,
      name: f.name as string,
      kind: isStr(f.kind) ? f.kind : "",
      size: typeof f.size === "number" ? f.size : 0,
      addedAt: isStr(f.addedAt) ? f.addedAt : new Date(0).toISOString(),
      data: f.data as string,
    }));
  const settings: Record<string, string> = {};
  if (isObj(raw.settings)) {
    for (const key of BACKUP_SETTING_KEYS) {
      const v = raw.settings[key];
      if (isStr(v)) settings[key] = v;
    }
  }
  const t = isObj(raw.tags) ? raw.tags : {};
  const backup: BackupFile = {
    app: BACKUP_APP,
    format: raw.format,
    createdAt: isStr(raw.createdAt) && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date(0).toISOString(),
    counts: { ...countEntries(entries as Array<{ type?: unknown; deletedAt?: unknown }>), themes: themes.length, icons: icons.length, fonts: fonts.length },
    entries,
    tags: { notes: strList(t.notes), todos: strList(t.todos), boards: strList(t.boards) },
    themes,
    icons,
    fonts,
    settings,
  };
  return { ok: true, backup };
}

// ------------------------------------------------------------------ planning

export interface RestoreExisting {
  entries: ReadonlyArray<{ id: string; lastModified: string }>;
  themeIds: ReadonlySet<string>;
  iconIds: ReadonlySet<string>;
  fontIds: ReadonlySet<string>;
  /** lower-cased */
  fontNames: ReadonlySet<string>;
}

export interface RestorePlan {
  addEntries: Entry[];
  updateEntries: Entry[];
  /** Entries in the backup that the phone already has, same or newer. */
  keptEntries: number;
  /** Entries in the backup that couldn't be read. */
  invalidEntries: number;
  themes: CustomTheme[];
  icons: CustomIcon[];
  fonts: BackupFont[];
  keptMedia: number;
  tags: BackupFile["tags"];
  settings: Record<string, string>;
}

export function planRestore(backup: BackupFile, existing: RestoreExisting, normalize: (raw: unknown) => Entry | null): RestorePlan {
  const have = new Map(existing.entries.map((e) => [e.id, Date.parse(e.lastModified)]));
  const plan: RestorePlan = {
    addEntries: [],
    updateEntries: [],
    keptEntries: 0,
    invalidEntries: 0,
    themes: [],
    icons: [],
    fonts: [],
    keptMedia: 0,
    tags: backup.tags,
    settings: backup.settings,
  };
  const seen = new Set<string>();
  for (const raw of backup.entries) {
    const e = normalize(raw);
    if (!e) {
      plan.invalidEntries++;
      continue;
    }
    if (seen.has(e.id)) continue; // a duplicate id inside the file: the first one counts
    seen.add(e.id);
    if (!have.has(e.id)) plan.addEntries.push(e);
    else if (Date.parse(e.lastModified) > (have.get(e.id) as number)) plan.updateEntries.push(e);
    else plan.keptEntries++;
  }
  for (const t of backup.themes) (existing.themeIds.has(t.id) ? plan.keptMedia++ : plan.themes.push(t));
  for (const i of backup.icons) (existing.iconIds.has(i.id) ? plan.keptMedia++ : plan.icons.push(i));
  for (const f of backup.fonts) {
    if (existing.fontIds.has(f.id) || existing.fontNames.has(f.name.toLowerCase())) plan.keptMedia++;
    else plan.fonts.push(f);
  }
  return plan;
}

// ------------------------------------------------------------------ applying

export interface RestoreSink {
  /** Save one entry exactly as given (its last-modified is NOT touched). Resolves when it is stored. */
  saveEntry(entry: Entry): Promise<void>;
  addTheme(theme: CustomTheme): Promise<void>;
  addIcon(icon: CustomIcon): Promise<void>;
  /** "added" | "kept" | "failed" */
  addFont(font: BackupFont): Promise<"added" | "kept" | "failed">;
  addTag(kind: "notes" | "todos" | "boards", tag: string): void;
  setSetting(key: string, value: string): void;
  /** Let the UI breathe between chunks of work. */
  tick?(): Promise<void>;
}

export interface RestoreReport {
  entriesAdded: number;
  entriesUpdated: number;
  entriesKept: number;
  entriesInvalid: number;
  entriesFailed: number;
  themesAdded: number;
  iconsAdded: number;
  fontsAdded: number;
  mediaKept: number;
  mediaFailed: number;
  tagsAdded: number;
  settingsApplied: number;
}

export type RestoreProgress = (done: number, total: number) => void;

export async function applyRestore(plan: RestorePlan, sink: RestoreSink, onProgress?: RestoreProgress): Promise<RestoreReport> {
  const r: RestoreReport = {
    entriesAdded: 0,
    entriesUpdated: 0,
    entriesKept: plan.keptEntries,
    entriesInvalid: plan.invalidEntries,
    entriesFailed: 0,
    themesAdded: 0,
    iconsAdded: 0,
    fontsAdded: 0,
    mediaKept: plan.keptMedia,
    mediaFailed: 0,
    tagsAdded: 0,
    settingsApplied: 0,
  };
  const total = plan.themes.length + plan.icons.length + plan.fonts.length + plan.addEntries.length + plan.updateEntries.length;
  let done = 0;
  const step = async () => {
    done++;
    onProgress?.(done, total);
    if (done % 8 === 0) await sink.tick?.();
  };

  // Pictures and fonts first: the notes that use them then paint correctly the moment they appear.
  for (const t of plan.themes) {
    try {
      await sink.addTheme(t);
      r.themesAdded++;
    } catch {
      r.mediaFailed++;
    }
    await step();
  }
  for (const i of plan.icons) {
    try {
      await sink.addIcon(i);
      r.iconsAdded++;
    } catch {
      r.mediaFailed++;
    }
    await step();
  }
  for (const f of plan.fonts) {
    try {
      const out = await sink.addFont(f);
      if (out === "added") r.fontsAdded++;
      else if (out === "kept") r.mediaKept++;
      else r.mediaFailed++;
    } catch {
      r.mediaFailed++;
    }
    await step();
  }

  for (const kind of ["notes", "todos", "boards"] as const) {
    for (const tag of plan.tags[kind]) {
      try {
        sink.addTag(kind, tag);
        r.tagsAdded++;
      } catch {
        /* a tag that can't be added isn't worth failing the restore */
      }
    }
  }

  for (const e of plan.addEntries) {
    try {
      await sink.saveEntry(e);
      r.entriesAdded++;
    } catch {
      r.entriesFailed++;
    }
    await step();
  }
  for (const e of plan.updateEntries) {
    try {
      await sink.saveEntry(e);
      r.entriesUpdated++;
    } catch {
      r.entriesFailed++;
    }
    await step();
  }

  for (const [key, value] of Object.entries(plan.settings)) {
    if (!BACKUP_SETTING_KEYS.includes(key)) continue;
    try {
      sink.setSetting(key, value);
      r.settingsApplied++;
    } catch {
      /* ignore */
    }
  }
  return r;
}

/** Lines for the "what happened" panel. */
export function describeReport(r: RestoreReport): string[] {
  const lines: string[] = [];
  const entryBits: string[] = [];
  if (r.entriesAdded) entryBits.push(`${r.entriesAdded} added`);
  if (r.entriesUpdated) entryBits.push(`${r.entriesUpdated} updated to the newer copy`);
  if (r.entriesKept) entryBits.push(`${r.entriesKept} already here (kept)`);
  lines.push(entryBits.length ? `Notes, todos & boards: ${entryBits.join(", ")}.` : "Notes, todos & boards: nothing to add.");
  const media: string[] = [];
  if (r.themesAdded) media.push(`${r.themesAdded} theme${r.themesAdded === 1 ? "" : "s"}`);
  if (r.iconsAdded) media.push(`${r.iconsAdded} icon${r.iconsAdded === 1 ? "" : "s"}`);
  if (r.fontsAdded) media.push(`${r.fontsAdded} font${r.fontsAdded === 1 ? "" : "s"}`);
  if (media.length) lines.push(`Added ${media.join(", ")}.`);
  if (r.settingsApplied) lines.push("Look and feel settings applied — restart the app to see them.");
  if (r.entriesInvalid) lines.push(`${r.entriesInvalid} item${r.entriesInvalid === 1 ? " in the file was" : "s in the file were"} unreadable and skipped.`);
  if (r.entriesFailed) lines.push(`${r.entriesFailed} item${r.entriesFailed === 1 ? "" : "s"} couldn't be saved.`);
  if (r.mediaFailed) lines.push(`${r.mediaFailed} picture${r.mediaFailed === 1 ? "" : "s"} or font${r.mediaFailed === 1 ? "" : "s"} couldn't be restored.`);
  return lines;
}
