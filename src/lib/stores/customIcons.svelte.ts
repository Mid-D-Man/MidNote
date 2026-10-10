// Reactive custom-icon registry — same shape/reasoning as
// customThemes.svelte.ts (Svelte 5 runes state in front of a MediaCollection),
// kept as its own store rather than folded into that one: a different
// collection (icons, not theme backgrounds) with its own storage and its own
// size/format rules (see storage.ts's storeCustomIconImage).
// Round 43: IndexedDB, filled by initCustomIcons() at startup — see
// customThemes.svelte.ts.
import type { CustomIcon } from "$lib/types/entry";
import * as storage from "$lib/storage";
import { MediaCollection } from "$lib/utils/mediaCollection";
import { openMediaBackend } from "$lib/utils/mediaDb";
import { breadcrumb } from "$lib/debug/log.svelte";

const collection = new MediaCollection<CustomIcon>({
  open: () => openMediaBackend<CustomIcon>("icons"),
  legacy: { load: storage.loadCustomIcons, save: storage.saveCustomIcons, clear: storage.clearLegacyCustomIcons },
  log: (m) => breadcrumb(`icons: ${m}`),
});

export const customIcons = $state<CustomIcon[]>([]);

function sync() {
  customIcons.splice(0, customIcons.length, ...collection.items);
}

/** Load (and, the first time, migrate) the icons. Never throws. */
export async function initCustomIcons(): Promise<void> {
  await collection.init();
  sync();
}

export async function addCustomIcon(file: File): Promise<CustomIcon> {
  const icon = await storage.storeCustomIconImage(file);
  await collection.add(icon); // throws a readable Error if it can't be kept
  sync();
  return icon;
}

/** Backup restore: add an icon from a backup unless its id is already here. Throws if it can't be kept. */
export async function restoreCustomIcon(icon: CustomIcon): Promise<void> {
  if (collection.items.some((i) => i.id === icon.id)) return;
  await collection.add(icon);
  sync();
}

export function removeCustomIcon(id: string) {
  void collection.remove(id);
  sync();
}
