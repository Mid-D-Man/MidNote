// Reactive custom-icon registry — same shape/reasoning as
// customThemes.svelte.ts (Svelte 5 runes state backed by storage.ts),
// kept as its own store rather than folded into that one: a different
// collection (icons, not theme backgrounds) with its own registry key
// and its own size/format rules (see storage.ts's storeCustomIconImage).
import type { CustomIcon } from "$lib/types/entry";
import * as storage from "$lib/storage";
import { untrack } from "svelte";

export const customIcons = $state<CustomIcon[]>(storage.loadCustomIcons());

export function refreshCustomIcons() {
  // Same read-then-write-same-state shape as customThemes.svelte.ts's
  // refreshCustomThemes() — untracked for the same reason: never called
  // from inside an $effect today, but guarding against the
  // effect_update_depth_exceeded class of bug preemptively costs nothing.
  untrack(() => {
    customIcons.splice(0, customIcons.length, ...storage.loadCustomIcons());
  });
}

export async function addCustomIcon(file: File): Promise<CustomIcon> {
  const icon = await storage.storeCustomIconImage(file);
  refreshCustomIcons();
  return icon;
}

export function removeCustomIcon(id: string) {
  storage.deleteCustomIcon(id);
  refreshCustomIcons();
}
