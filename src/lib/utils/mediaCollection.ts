// Round 43 — one collection of uploaded images (all the custom themes, or all the
// custom icons): where it lives, how it is moved off localStorage, what happens
// when IndexedDB isn't there. Plain TypeScript (no runes) so the logic can be
// tested in Node; stores/customThemes.svelte.ts and customIcons.svelte.ts are
// the thin reactive wrappers the UI uses.
//
// STORAGE MODES
//   "indexeddb"  the normal case. Rows live in IndexedDB (utils/mediaDb.ts).
//   "local"      IndexedDB isn't available (or the migration couldn't be
//                verified): the old localStorage list keeps working exactly as
//                before, so nobody loses their themes.
//
// MIGRATION (init): anything still in the old localStorage list is copied into
// IndexedDB, then READ BACK. Only when every old item is verifiably in the
// database is the localStorage copy deleted — and that is the very last step, so
// no failure along the way can lose an image. Items already in the database are
// never overwritten by the old copy.

import type { MediaBackend } from "$lib/utils/mediaDb";

export interface LegacyStore<T> {
  load(): T[];
  save(items: T[]): void;
  clear(): void;
}

export interface MediaCollectionDeps<T extends { id: string }> {
  open: () => Promise<MediaBackend<T> | null>;
  legacy: LegacyStore<T>;
  log?: (msg: string) => void;
}

const SAVE_FAILED = "Couldn't save that image on this device — its storage may be full.";

function oldestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class MediaCollection<T extends { id: string; createdAt: string }> {
  private backend: MediaBackend<T> | null = null;
  private list: T[] = [];
  /** Where the images are kept right now. */
  mode: "indexeddb" | "local" = "local";

  constructor(private d: MediaCollectionDeps<T>) {}

  /** The current images, oldest first. */
  get items(): readonly T[] {
    return this.list;
  }

  private useLocal(legacy: T[]) {
    this.backend = null;
    this.mode = "local";
    this.list = [...legacy];
  }

  /** Load (and, the first time, migrate). Never throws. */
  async init(): Promise<void> {
    let legacy: T[] = [];
    try {
      legacy = this.d.legacy.load();
    } catch (err) {
      this.d.log?.(`media: couldn't read the old localStorage list (${describe(err)})`);
    }

    let backend: MediaBackend<T> | null = null;
    try {
      backend = await this.d.open();
    } catch (err) {
      this.d.log?.(`media: couldn't open IndexedDB (${describe(err)})`);
    }
    if (!backend) {
      this.useLocal(legacy);
      return;
    }

    try {
      const have = new Set((await backend.all()).map((x) => x.id));
      let moved = 0;
      for (const item of legacy) {
        if (have.has(item.id)) continue; // the database's copy wins
        await backend.put(item);
        moved++;
      }
      const all = await backend.all();
      const present = new Set(all.map((x) => x.id));
      if (!legacy.every((x) => present.has(x.id))) throw new Error("the copy in IndexedDB couldn't be verified");

      this.list = oldestFirst(all);
      this.backend = backend;
      this.mode = "indexeddb";
      if (moved > 0) this.d.log?.(`media: moved ${moved} item(s) from localStorage to IndexedDB`);
      if (legacy.length > 0) {
        // Last step, on purpose: everything above has already succeeded.
        try {
          this.d.legacy.clear();
        } catch (err) {
          this.d.log?.(`media: couldn't remove the old localStorage copy (${describe(err)})`);
        }
      }
    } catch (err) {
      this.d.log?.(`media: IndexedDB migration failed (${describe(err)}) — staying on localStorage`);
      this.useLocal(legacy);
    }
  }

  /** Save a new image. Throws an Error with a user-readable message when it can't be kept. */
  async add(item: T): Promise<void> {
    try {
      if (this.backend) await this.backend.put(item);
      else this.d.legacy.save([...this.list, item]);
    } catch (err) {
      this.d.log?.(`media: saving failed (${describe(err)})`);
      throw new Error(SAVE_FAILED);
    }
    this.list = oldestFirst([...this.list, item]);
  }

  /** Remove an image. It leaves `items` immediately; the write follows. Never throws. */
  async remove(id: string): Promise<void> {
    this.list = this.list.filter((x) => x.id !== id);
    try {
      if (this.backend) await this.backend.remove(id);
      else this.d.legacy.save(this.list);
    } catch (err) {
      this.d.log?.(`media: removing failed (${describe(err)})`);
    }
  }
}
