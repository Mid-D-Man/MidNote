// Searching the Folders tab. Pure rules, no Svelte.
//
// The search looks at EVERYTHING filed in folders, not only the folder that is open: a folder, note, todo or board matches
// when its name contains what was typed, or one of its tags does (own tags or ones inherited from folders above it).
// Case does not matter. Folders come first (by name), then the rest, newest first.
import { effectiveTags, type FolderView } from "$lib/utils/folders";

export const MAX_SEARCH_RESULTS = 200;

export interface SearchResult {
  id: string;
  isFolder: boolean;
}

/** `query` cleaned for matching: trimmed, lower-cased. "" means "not searching". */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * The ids that match, in order, and how many matched in all (the list is cut at MAX_SEARCH_RESULTS).
 * `modifiedAt(id)` is the item's last-modified time in ms (0 when unknown), used to put the newest first.
 */
export function searchFolderView(
  view: FolderView,
  query: string,
  modifiedAt: (id: string) => number
): { results: SearchResult[]; total: number } {
  const q = normalizeQuery(query);
  if (q === "") return { results: [], total: 0 };
  const folders: string[] = [];
  const items: string[] = [];
  for (const [id, node] of view.byId) {
    const inTitle = (node.title || "").toLowerCase().includes(q);
    const matches = inTitle || effectiveTags(view, id).all.some((t) => t.toLowerCase().includes(q));
    if (!matches) continue;
    (node.type === "folder" ? folders : items).push(id);
  }
  const title = (id: string) => (view.byId.get(id)?.title || "").toLowerCase();
  folders.sort((a, b) => title(a).localeCompare(title(b)));
  items.sort((a, b) => modifiedAt(b) - modifiedAt(a));
  const all = [...folders.map((id) => ({ id, isFolder: true })), ...items.map((id) => ({ id, isFolder: false }))];
  return { results: all.slice(0, MAX_SEARCH_RESULTS), total: all.length };
}
