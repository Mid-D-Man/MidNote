// Round 43 — IndexedDB home for the user's uploaded theme backgrounds and icon
// badges (they used to live in localStorage as base64 text).
//
// WHY: localStorage is one ~5 MB budget shared by every note, todo and board,
// and a single photo background is ~100-300 KB of base64. A handful of themes
// could make saving NOTES start failing. IndexedDB has a far larger quota and
// exists in the Android WebView with nothing to install (custom fonts already
// use it — utils/fontLibrary.ts).
//
// One database, one object store per kind, rows keyed by `id`. Plain
// TypeScript with the IDBFactory passed in, so it can be exercised in Node
// against a real IndexedDB implementation. The migration and the "what if
// there is no IndexedDB" logic live in utils/mediaCollection.ts.

export type MediaKind = "themes" | "icons";

export interface MediaBackend<T extends { id: string }> {
  all(): Promise<T[]>;
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "midnote-media";
const KINDS: MediaKind[] = ["themes", "icons"];

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const kind of KINDS) {
        if (!req.result.objectStoreNames.contains(kind)) req.result.createObjectStore(kind, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
}

// Resolves on transaction COMPLETE (not request success): for a write that is
// the moment it is durable.
function run<R>(db: IDBDatabase, store: MediaKind, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    let value: R;
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => {
      value = req.result;
    };
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error ?? req.error ?? new Error("indexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("indexedDB transaction aborted"));
  });
}

/**
 * Opens the database and returns the backend for one kind — or null when there is
 * no usable IndexedDB (jsdom, a locked-down WebView, a failed open). Never throws.
 */
export async function openMediaBackend<T extends { id: string }>(
  kind: MediaKind,
  idb: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<MediaBackend<T> | null> {
  if (!idb) return null;
  try {
    const db = await openDb(idb);
    return {
      all: () => run(db, kind, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
      put: async (item) => void (await run(db, kind, "readwrite", (s) => s.put(item))),
      remove: async (id) => void (await run(db, kind, "readwrite", (s) => s.delete(id))),
    };
  } catch (err) {
    console.error(`media db: couldn't open IndexedDB for ${kind}, falling back to localStorage:`, err);
    return null;
  }
}
