// Reactive custom-theme registry — same shape/reasoning as
// entries.svelte.ts (Svelte 5 runes state backed by storage.ts), kept
// separate because it's a different collection with a different
// lifecycle (uploaded once, referenced by id from many entries, never
// tied to a single note/todo's own load/save cycle).
import type { CustomTheme } from "$lib/types/entry";
import * as storage from "$lib/storage";
import { untrack } from "svelte";

export const customThemes = $state<CustomTheme[]>(storage.loadCustomThemes());

export function refreshCustomThemes() {
  // Same read-then-write-same-state shape as entries.svelte.ts's
  // refresh() — untracked for the same reason: this is never called
  // from inside an $effect today, but guarding against the
  // effect_update_depth_exceeded class of bug preemptively costs
  // nothing (see docs/incidents/2026-08-22-effect-update-depth-exceeded.md).
  untrack(() => {
    customThemes.splice(0, customThemes.length, ...storage.loadCustomThemes());
  });
}

export async function addCustomTheme(file: File): Promise<CustomTheme> {
  const theme = await storage.storeCustomThemeImage(file);
  refreshCustomThemes();
  return theme;
}

export function removeCustomTheme(id: string) {
  storage.deleteCustomTheme(id);
  refreshCustomThemes();
}
