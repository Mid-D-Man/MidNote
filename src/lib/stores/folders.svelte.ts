// Folders (round 47) — the live view over every entry, where the Folders tab is browsing,
// and the few operations the UI needs. The rules themselves are in utils/folders.ts.
import { entries, removeEntry, refresh, saveEntry } from "$lib/stores/entries.svelte";
import * as storage from "$lib/storage";
import { buildFolderView, canMove, planFolderDelete, MAX_FOLDER_DEPTH, refusalText, type FolderView, type MoveCheck } from "$lib/utils/folders";
import type { Folder } from "$lib/types/entry";

// Rebuilt whenever any entry changes. Cheap: one pass over the list.
const view = $derived(buildFolderView(entries));
export const folderState = {
  get view(): FolderView {
    return view;
  },
};

// Where the Folders tab is showing. Module state, so opening a note from inside a folder and
// coming back lands in the same folder (the landing route remounts on every return).
const nav = $state<{ currentId: string | null }>({ currentId: null });
export const folderNav = {
  /** The open folder, or null for the top level (also if the folder has since been deleted). */
  get currentId(): string | null {
    const id = nav.currentId;
    return id !== null && view.folders.has(id) ? id : null;
  },
  open(id: string | null) {
    nav.currentId = id;
  },
};

export type CreateFolderResult = { ok: true; folder: Folder } | { ok: false; message: string };

export const FOLDER_NAME_MAX = 80;

export function createFolderIn(parentId: string | null, rawName: string): CreateFolderResult {
  const name = rawName.trim();
  if (!name) return { ok: false, message: "Give the folder a name" };
  if (name.length > FOLDER_NAME_MAX) return { ok: false, message: `Keep the name under ${FOLDER_NAME_MAX} characters` };
  if (parentId !== null) {
    if (!view.folders.has(parentId)) return { ok: false, message: refusalText("not-a-folder") };
    if (view.depth.get(parentId)! + 1 > MAX_FOLDER_DEPTH) return { ok: false, message: refusalText("too-deep") };
  }
  const folder = storage.createFolder(parentId, name);
  saveEntry(folder);
  return { ok: true, folder };
}

/** File these entries into a folder (null = top level). Nothing moves unless every one can. */
export function moveEntriesTo(ids: readonly string[], targetId: string | null): MoveCheck {
  const check = canMove(view, ids, targetId);
  if (!check.ok) return check;
  for (const id of ids) storage.setParent(id, targetId);
  refresh();
  return check;
}

/**
 * Delete a folder (to the Trash, like everything else).
 * "lift": only the folder goes; what was directly inside moves up one level.
 * "all": the folder and everything under it go together.
 */
export function deleteFolder(folderId: string, mode: "lift" | "all") {
  const plan = planFolderDelete(view, folderId, mode);
  for (const r of plan.reparent) storage.setParent(r.id, r.parentId);
  for (const id of plan.trashIds) removeEntry(id);
}

/** The folder named in a `?folder=` URL, if it is a real, live folder; otherwise null (top level). */
export function parentFromUrl(url: URL): string | null {
  const id = url.searchParams.get("folder");
  return id && view.folders.has(id) ? id : null;
}

// "Move to folder" is asked for from several places (a card's menu, the selection bar, a
// folder's own sheet); one picker hosted on the landing page answers all of them.
export interface MoveRequest {
  ids: string[];
  /** called after a successful move (e.g. to leave multi-select) */
  onMoved?: () => void;
}
const moveRequestState = $state<{ current: MoveRequest | null }>({ current: null });
export const moveRequest = {
  get current(): MoveRequest | null {
    return moveRequestState.current;
  },
};
export function requestMove(ids: string[], onMoved?: () => void) {
  if (ids.length === 0) return;
  moveRequestState.current = { ids: [...ids], onMoved };
}
export function clearMoveRequest() {
  moveRequestState.current = null;
}
