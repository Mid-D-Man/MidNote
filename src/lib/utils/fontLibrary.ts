// Round 33 — the storage and registration side of custom fonts, kept as
// plain TypeScript (no Svelte runes) so it can be exercised in Node with a
// real IndexedDB implementation. stores/customFonts.svelte.ts is the thin
// reactive wrapper the UI actually uses.
//
// WHY INDEXEDDB, NOT localStorage like custom icons/themes: a font file is
// routinely 100 KB - several MB. localStorage holds strings only (so base64,
// +33%) under a ~5 MB total budget shared with every note, icon and theme —
// a couple of fonts would quietly start failing note saves. IndexedDB stores
// the raw bytes, with a far larger quota, and exists in the Android WebView
// with no plugin or Rust change.
//
// WHAT'S STORED: { id, name, kind, size, addedAt, bytes }. Registration with
// the browser (FontFace) happens at app start for every stored font, and
// immediately after an import.

import {
  MAX_CUSTOM_FONTS,
  MAX_FONT_BYTES,
  detectFontKind,
  fontNameFromFile,
  uniqueFontName,
  type FontKind,
} from "$lib/utils/fonts";

export type CustomFont = { id: string; name: string; kind: FontKind; size: number; addedAt: string };
export type StoredFont = CustomFont & { bytes: ArrayBuffer };

export interface FontBackend {
  readonly persistent: boolean;
  all(): Promise<StoredFont[]>;
  put(font: StoredFont): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What actually talks to the browser's font machinery. Absent in jsdom/SSR -> null host -> nothing is registered. */
export interface FaceHost {
  /** Register `bytes` under family `name`. Rejects when the browser can't use the data. */
  add(name: string, bytes: ArrayBuffer): Promise<unknown>;
  remove(handle: unknown): void;
}

export type AddResult = { ok: true; font: CustomFont } | { ok: false; message: string };

const DB_NAME = "midnote-fonts";
const STORE = "fonts";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ------------------------------------------------------------- backends

export function memoryBackend(): FontBackend {
  const rows = new Map<string, StoredFont>();
  return {
    persistent: false,
    all: async () => [...rows.values()],
    put: async (f) => void rows.set(f.id, f),
    remove: async (id) => void rows.delete(id),
  };
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
}

// Resolves on transaction COMPLETE (not request success): for a write that is
// the moment it is durable.
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let value: T;
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => {
      value = req.result;
    };
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error ?? req.error ?? new Error("indexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("indexedDB transaction aborted"));
  });
}

/** Opens the real database, or throws. Callers fall back to memoryBackend() and say so. */
export async function idbBackend(idb: IDBFactory = indexedDB): Promise<FontBackend> {
  const db = await openDb(idb);
  return {
    persistent: true,
    all: () => run(db, "readonly", (s) => s.getAll() as IDBRequest<StoredFont[]>),
    put: async (f) => void (await run(db, "readwrite", (s) => s.put(f))),
    remove: async (id) => void (await run(db, "readwrite", (s) => s.delete(id))),
  };
}

// ------------------------------------------------------------- the browser side

/** FontFace-backed host, or null where the API doesn't exist (jsdom, old WebView). */
export function browserFaceHost(): FaceHost | null {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return null;
  return {
    async add(name, bytes) {
      // The family goes in as a quoted CSS string: names are stripped of
      // quotes (fontNameFromFile) and a bare name like "3270 Font" would not
      // parse as an identifier.
      const face = new FontFace(`"${name}"`, bytes);
      await face.load();
      document.fonts.add(face);
      return face;
    },
    remove(handle) {
      document.fonts.delete(handle as FontFace);
    },
  };
}

// ------------------------------------------------------------- the library

export type ImportFile = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

export class FontLibrary {
  private handles = new Map<string, unknown>();

  constructor(
    private backend: FontBackend,
    private host: FaceHost | null,
    private log: (msg: string) => void = () => {},
  ) {}

  get persistent(): boolean {
    return this.backend.persistent;
  }

  /** Every stored font, registered with the browser. A font that fails to register stays listed (so it can be deleted) but is logged. */
  async load(): Promise<CustomFont[]> {
    let rows: StoredFont[] = [];
    try {
      rows = await this.backend.all();
    } catch (err) {
      this.log(`fonts: couldn't read stored fonts (${describe(err)})`);
      return [];
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    await Promise.all(rows.map((r) => this.register(r)));
    return rows.map(({ bytes: _bytes, ...meta }) => meta);
  }

  private async register(f: StoredFont): Promise<boolean> {
    if (!this.host) return false;
    try {
      this.handles.set(f.id, await this.host.add(f.name, f.bytes));
      return true;
    } catch (err) {
      this.log(`fonts: "${f.name}" could not be registered (${describe(err)})`);
      return false;
    }
  }

  /**
   * Validate, register (which proves the browser can really use it), then
   * persist. Nothing is saved for a file that fails either step.
   */
  async add(file: ImportFile, existing: readonly CustomFont[], now: Date = new Date()): Promise<AddResult> {
    if (existing.length >= MAX_CUSTOM_FONTS) {
      return { ok: false, message: `You can keep up to ${MAX_CUSTOM_FONTS} fonts. Remove one first.` };
    }
    if (file.size > MAX_FONT_BYTES) {
      return { ok: false, message: `That font file is too large (limit ${Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB).` };
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (err) {
      this.log(`fonts: couldn't read "${file.name}" (${describe(err)})`);
      return { ok: false, message: "Couldn't read that file." };
    }
    if (bytes.byteLength > MAX_FONT_BYTES) {
      return { ok: false, message: `That font file is too large (limit ${Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB).` };
    }
    const kind = detectFontKind(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)));
    if (!kind) {
      return { ok: false, message: "That isn't a font file. Pick a .ttf, .otf, .woff or .woff2 file." };
    }
    const name = uniqueFontName(fontNameFromFile(file.name), existing.map((f) => f.name));
    const stored: StoredFont = {
      id: `font-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      kind,
      size: bytes.byteLength,
      addedAt: now.toISOString(),
      bytes,
    };

    if (this.host) {
      try {
        this.handles.set(stored.id, await this.host.add(name, bytes));
      } catch (err) {
        this.log(`fonts: "${file.name}" rejected by the browser (${describe(err)})`);
        return { ok: false, message: "That file couldn't be loaded as a font." };
      }
    }
    try {
      await this.backend.put(stored);
    } catch (err) {
      this.unregister(stored.id);
      this.log(`fonts: couldn't save "${name}" (${describe(err)})`);
      return { ok: false, message: "Couldn't save the font — device storage may be full." };
    }
    this.log(`fonts: imported "${name}" (${kind}, ${stored.size} bytes, ${this.backend.persistent ? "saved" : "this session only"})`);
    const { bytes: _b, ...meta } = stored;
    return { ok: true, font: meta };
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.backend.remove(id);
    } catch (err) {
      this.log(`fonts: couldn't delete ${id} (${describe(err)})`);
      return false;
    }
    this.unregister(id);
    return true;
  }

  private unregister(id: string) {
    const h = this.handles.get(id);
    if (h !== undefined && this.host) {
      try {
        this.host.remove(h);
      } catch {
        // already gone
      }
    }
    this.handles.delete(id);
  }
}
