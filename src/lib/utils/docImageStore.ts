// The pictures of PowerPoint / Word / PDF files that were opened as notes, kept on THIS phone next to the note (the note itself stays
// text only). Keyed by the note's id, so nothing about them is in the note's own data: they are not synced. They ARE in a backup
// (utils/backup.ts: the "docImages" group), so a restore brings them back. Where there is no IndexedDB (a browser test) they are
// kept in memory for the session.
//
// Pictures over about 400 KB are shrunk before they are kept (shrinkImage), so a long deck stays a reasonable size.
// Tests replace the whole backend with globalThis.__midnoteDocImages.
import type { DocImage, DocImageKind } from "$lib/utils/docImages";
import { breadcrumb } from "$lib/debug/log.svelte";

export interface DocImageMeta {
  /** "<note id>/<number>": what a picture block refers to. */
  key: string;
  kind: DocImageKind;
  /** The slide / page number, or the line of the note's text the picture follows. */
  at: number;
  mime: string;
  size: number;
}

export interface DocImageBackend {
  put(noteId: string, items: { meta: DocImageMeta; bytes: Uint8Array }[]): Promise<void>;
  list(noteId: string): Promise<DocImageMeta[]>;
  get(key: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
  remove(noteId: string): Promise<void>;
  /** The ids of every note that has pictures. */
  noteIds(): Promise<string[]>;
}

const byKeyOrder = (a: DocImageMeta, b: DocImageMeta) => a.key.localeCompare(b.key, undefined, { numeric: true });

// ------------------------------------------------------------------------------------------------------------------ memory
export class MemoryDocImages implements DocImageBackend {
  private byNote = new Map<string, { meta: DocImageMeta; bytes: Uint8Array }[]>();
  async put(noteId: string, items: { meta: DocImageMeta; bytes: Uint8Array }[]): Promise<void> {
    this.byNote.set(noteId, items.slice());
  }
  async list(noteId: string): Promise<DocImageMeta[]> {
    return (this.byNote.get(noteId) ?? []).map((i) => i.meta).sort(byKeyOrder);
  }
  async get(key: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    const noteId = key.slice(0, key.lastIndexOf("/"));
    const hit = (this.byNote.get(noteId) ?? []).find((i) => i.meta.key === key);
    return hit ? { mime: hit.meta.mime, bytes: hit.bytes } : null;
  }
  async remove(noteId: string): Promise<void> {
    this.byNote.delete(noteId);
  }
  async noteIds(): Promise<string[]> {
    return [...this.byNote.keys()];
  }
}

// ------------------------------------------------------------------------------------------------------------- IndexedDB
const DB_NAME = "midnote-doc-images";
const STORE = "images";

interface Row extends DocImageMeta {
  noteId: string;
  bytes: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("noteId", "noteId", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB could not be opened"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

class IndexedDocImages implements DocImageBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }
  private async removeIn(store: IDBObjectStore, noteId: string): Promise<void> {
    const keys = await request(store.index("noteId").getAllKeys(IDBKeyRange.only(noteId)));
    for (const k of keys) store.delete(k);
  }
  async put(noteId: string, items: { meta: DocImageMeta; bytes: Uint8Array }[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await this.removeIn(store, noteId);
    for (const it of items) {
      const copy = it.bytes.slice().buffer as ArrayBuffer;
      store.put({ ...it.meta, noteId, bytes: copy } satisfies Row);
    }
    await done(tx);
  }
  async list(noteId: string): Promise<DocImageMeta[]> {
    const db = await this.db();
    const rows = await request(db.transaction(STORE).objectStore(STORE).index("noteId").getAll(IDBKeyRange.only(noteId)) as IDBRequest<Row[]>);
    return rows.map(({ key, kind, at, mime, size }) => ({ key, kind, at, mime, size })).sort(byKeyOrder);
  }
  async get(key: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    const db = await this.db();
    const row = await request(db.transaction(STORE).objectStore(STORE).get(key) as IDBRequest<Row | undefined>);
    return row ? { mime: row.mime, bytes: new Uint8Array(row.bytes) } : null;
  }
  async remove(noteId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, "readwrite");
    await this.removeIn(tx.objectStore(STORE), noteId);
    await done(tx);
  }
  async noteIds(): Promise<string[]> {
    const db = await this.db();
    const req = db.transaction(STORE).objectStore(STORE).index("noteId").openKeyCursor(null, "nextunique");
    // a cursor over an index gives the INDEX key (the note id); "nextunique" visits each one once
    return new Promise<string[]>((resolve, reject) => {
      const ids: string[] = [];
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(ids);
        ids.push(String(c.key));
        c.continue();
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  }
}

let real: DocImageBackend | null = null;
function backend(): DocImageBackend {
  const seam = (globalThis as { __midnoteDocImages?: DocImageBackend }).__midnoteDocImages;
  if (seam) return seam;
  if (!real) real = typeof indexedDB !== "undefined" ? new IndexedDocImages() : new MemoryDocImages();
  return real;
}

// ------------------------------------------------------------------------------------------------------------------ shrink
const KEEP_AS_IS_BYTES = 400 * 1024;
const LONG_EDGE = 1400;
/** Even without a way to shrink, a picture over this is not kept. */
const MAX_KEPT_BYTES = 3 * 1024 * 1024;

/** A big picture drawn smaller and saved as JPEG; the original when it is small already, when the phone can't do it, or when that wouldn't be smaller. */
export async function shrinkImage(bytes: Uint8Array, mime: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (bytes.length <= KEEP_AS_IS_BYTES) return { mime, bytes };
  try {
    if (typeof createImageBitmap === "function" && (typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined")) {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      let blob: Blob | null = null;
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(bmp, 0, 0, w, h);
          blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        }
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(bmp, 0, 0, w, h);
          blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
        }
      }
      bmp.close?.();
      if (blob && blob.size > 0 && blob.size < bytes.length) return { mime: "image/jpeg", bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
  } catch {
    // fall through to the original
  }
  return bytes.length <= MAX_KEPT_BYTES ? { mime, bytes } : null;
}

// --------------------------------------------------------------------------------------------------------------- the API
// Keeping a note's pictures takes a moment (a big one is shrunk first). A reader that asks for them in that moment waits for them.
const saving = new Map<string, Promise<number>>();

/** Keep a note's pictures (replacing any it had). Returns how many were kept. Never throws: no space or no storage just means no pictures. */
export function saveDocImages(noteId: string, images: DocImage[]): Promise<number> {
  const run = keepDocImages(noteId, images);
  saving.set(noteId, run);
  void run.then(() => {
    if (saving.get(noteId) === run) saving.delete(noteId);
  });
  return run;
}

async function keepDocImages(noteId: string, images: DocImage[]): Promise<number> {
  try {
    const items: { meta: DocImageMeta; bytes: Uint8Array }[] = [];
    for (const img of images) {
      const shrunk = await shrinkImage(img.bytes, img.mime);
      if (!shrunk) continue;
      items.push({ meta: { key: `${noteId}/${items.length + 1}`, kind: img.kind, at: img.at, mime: shrunk.mime, size: shrunk.bytes.length }, bytes: shrunk.bytes });
    }
    if (items.length === 0) return 0;
    await backend().put(noteId, items);
    return items.length;
  } catch (e) {
    breadcrumb(`doc images: could not keep ${images.length} picture(s): ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/** What pictures a note has and where (empty when none, or when they can't be read). */
export async function loadDocImageMeta(noteId: string): Promise<DocImageMeta[]> {
  try {
    await saving.get(noteId); // (never rejects: keepDocImages catches everything)
    return await backend().list(noteId);
  } catch {
    return [];
  }
}

/** An address the page can show the picture from, and the call that frees it. Null when the picture is gone. */
export async function loadDocImageUrl(key: string): Promise<{ url: string; revoke: () => void } | null> {
  try {
    const r = await backend().get(key);
    if (!r) return null;
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
      return { url, revoke: () => URL.revokeObjectURL(url) };
    }
    let binary = "";
    for (let i = 0; i < r.bytes.length; i += 0x8000) binary += String.fromCharCode(...r.bytes.subarray(i, i + 0x8000));
    return { url: `data:${r.mime};base64,${btoa(binary)}`, revoke: () => {} };
  } catch {
    return null;
  }
}

/** Forget a note's pictures (the note was deleted for good). */
export async function deleteDocImages(noteId: string): Promise<void> {
  try {
    await backend().remove(noteId);
  } catch {
    // nothing to do: a picture left behind only takes space
  }
}

// ---------------------------------------------------------------------------------------------------- backup and restore
/** A picture with its bytes, as a backup carries it. */
export interface StoredDocImage {
  noteId: string;
  meta: DocImageMeta;
  bytes: Uint8Array;
}

/**
 * The pictures of the given notes, with their bytes, for a backup. Stops adding once `maxBytes` is reached; `leftOut` is how many
 * pictures that left behind. Never throws: a note whose pictures can't be read is just not in the result.
 */
export async function exportDocImages(noteIds: readonly string[], maxBytes: number): Promise<{ images: StoredDocImage[]; leftOut: number }> {
  const images: StoredDocImage[] = [];
  let total = 0;
  let leftOut = 0;
  try {
    const b = backend();
    const have = new Set(await b.noteIds());
    for (const noteId of noteIds) {
      if (!have.has(noteId)) continue;
      let metas: DocImageMeta[] = [];
      try {
        metas = await b.list(noteId);
      } catch {
        continue;
      }
      for (const meta of metas) {
        if (total + meta.size > maxBytes) {
          leftOut++;
          continue;
        }
        try {
          const got = await b.get(meta.key);
          if (!got) continue;
          total += got.bytes.length;
          images.push({ noteId, meta, bytes: got.bytes });
        } catch {
          // one unreadable picture does not stop the backup
        }
      }
    }
  } catch (e) {
    breadcrumb(`doc images: could not read pictures for the backup: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { images, leftOut };
}

/** The ids of the notes that already have pictures on this phone. Empty when they can't be read. */
export async function noteIdsWithDocImages(): Promise<Set<string>> {
  try {
    return new Set(await backend().noteIds());
  } catch {
    return new Set();
  }
}

/** Put a restored note's pictures back (they replace nothing: the caller only does this for a note that has none). Throws if they can't be kept. */
export async function restoreDocImages(noteId: string, items: { meta: DocImageMeta; bytes: Uint8Array }[]): Promise<void> {
  if (items.length === 0) return;
  await backend().put(noteId, items);
}
