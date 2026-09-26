// Thin wrapper around the Tauri commands in src-tauri/src/commands/.
// Every function here assumes it's only ever called when isTauriRuntime()
// is true (storage.ts's initStorage() is the one place that checks) —
// calling invoke() with no real Tauri runtime underneath (e.g. this
// project's own jsdom-based smoke-test harness) throws, by design,
// rather than silently resolving to something misleading.
import { invoke } from "@tauri-apps/api/core";

// Tauri v2 injects a real object at this key once its own JS runtime
// bridge has initialized; it's simply absent in any other environment
// (a plain browser tab, this project's jsdom-based smoke-test harness).
// Same detection approach Tauri's own official plugins use internally.
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAllEntries(): Promise<string> {
  return invoke("get_all_entries");
}

export async function saveEntry(id: string, entryJson: string): Promise<void> {
  await invoke("save_entry", { id, entryJson });
}

export async function deleteEntry(id: string): Promise<void> {
  await invoke("delete_entry", { id });
}

export async function getNotesIndex(): Promise<string> {
  return invoke("get_notes_index");
}

export async function getTodosIndex(): Promise<string> {
  return invoke("get_todos_index");
}

export async function getBoardsIndex(): Promise<string> {
  return invoke("get_boards_index");
}

export async function getTags(): Promise<string> {
  return invoke("get_tags");
}

export async function saveTags(tagsJson: string): Promise<void> {
  await invoke("save_tags", { tagsJson });
}
