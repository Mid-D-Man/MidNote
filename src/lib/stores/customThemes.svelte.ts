// Reactive custom-theme registry — Svelte 5 runes state in front of a
// MediaCollection (utils/mediaCollection.ts). Kept separate from the entries
// store because it's a different collection with a different lifecycle
// (uploaded once, referenced by id from many entries, never tied to a single
// note/todo's own load/save cycle).
//
// Round 43: the images live in IndexedDB now, not localStorage. The array below
// starts EMPTY and is filled by initCustomThemes(), which the root layout awaits
// before it shows anything (so a themed note never paints before its image is
// there). The first run also moves any themes still in the old localStorage list.
import type { CustomTheme } from "$lib/types/entry";
import * as storage from "$lib/storage";
import { MediaCollection } from "$lib/utils/mediaCollection";
import { openMediaBackend } from "$lib/utils/mediaDb";
import { breadcrumb } from "$lib/debug/log.svelte";

const collection = new MediaCollection<CustomTheme>({
  open: () => openMediaBackend<CustomTheme>("themes"),
  legacy: { load: storage.loadCustomThemes, save: storage.saveCustomThemes, clear: storage.clearLegacyCustomThemes },
  log: (m) => breadcrumb(`themes: ${m}`),
});

export const customThemes = $state<CustomTheme[]>([]);

function sync() {
  customThemes.splice(0, customThemes.length, ...collection.items);
}

/** Load (and, the first time, migrate) the themes. Never throws. */
export async function initCustomThemes(): Promise<void> {
  await collection.init();
  sync();
}

export async function addCustomTheme(file: File): Promise<CustomTheme> {
  const theme = await storage.storeCustomThemeImage(file);
  await collection.add(theme); // throws a readable Error if it can't be kept
  sync();
  return theme;
}

export function removeCustomTheme(id: string) {
  void collection.remove(id); // leaves the list at once; the write follows
  sync();
}
