// Folders (round 47) — the rules, as plain functions over a list of entries.
//
// An entry stores only `parentId`. Everything else is worked out from the whole list
// each time (buildFolderView), so there is nothing to keep in step: change a folder's
// tags and every entry under it follows at once; move an entry out and what it
// inherited is gone.
//
// The view is also a REPAIR step. The app itself never creates a cycle, a folder nested
// too deeply, or an entry pointing at a folder that is gone - but a backup restore, a
// sync from another device (A moves X into Y while B moves Y into X) or a hand-edited
// file can. Whatever arrives, the view is always a clean forest:
//   - a parent that is missing, in the Trash, or not a folder  -> the entry is top level
//   - a cycle                                                  -> its smallest id becomes top level
//   - a chain deeper than MAX_FOLDER_DEPTH                     -> re-rooted at the first folder past the limit
// and a structure that was already valid is left exactly as it was.
//
// Pure TypeScript (no store or storage imports) so it runs in Node tests.

/** Deepest allowed nesting: a top-level folder is depth 1, so at most 5 folders on any path. */
export const MAX_FOLDER_DEPTH = 5;

/** The little an entry needs to expose for these rules (every real entry has all of it). */
export interface FolderNode {
  id: string;
  type: string; // "folder" | "regular" | "todo" | "board"
  title: string;
  parentId: string | null;
  tags: string[];
  deletedAt: string | null;
}

export interface FolderView {
  /** every live (not trashed) entry by id */
  byId: Map<string, FolderNode>;
  /** every live folder by id */
  folders: Map<string, FolderNode>;
  /** effective parent of every live entry; null = top level */
  parent: Map<string, string | null>;
  /** depth of every live folder; a top-level folder is 1 */
  depth: Map<string, number>;
  /** effective children (folders and items) by parent id; null = top level */
  children: Map<string | null, string[]>;
}

export function buildFolderView(entries: readonly FolderNode[]): FolderView {
  const byId = new Map<string, FolderNode>();
  const folders = new Map<string, FolderNode>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    byId.set(e.id, e);
    if (e.type === "folder") folders.set(e.id, e);
  }

  // What an entry says, kept only if it names a live folder. (A folder naming itself is a cycle of one; step 1 handles it.)
  const rawParent = (n: FolderNode): string | null => (n.parentId && folders.has(n.parentId) ? n.parentId : null);

  const forcedRoot = new Set<string>();
  const parentOfFolder = (id: string): string | null => (forcedRoot.has(id) ? null : rawParent(folders.get(id)!));
  const ids = [...folders.keys()].sort();

  // 1. Break cycles: walk up from every folder; on meeting itself again, the smallest id in the loop is made top level.
  for (const start of ids) {
    const seen = new Map<string, number>();
    const path: string[] = [];
    let cur: string | null = start;
    while (cur !== null) {
      const at = seen.get(cur);
      if (at !== undefined) {
        const loop = path.slice(at);
        forcedRoot.add(loop.reduce((a, b) => (a < b ? a : b)));
        break;
      }
      seen.set(cur, path.length);
      path.push(cur);
      cur = parentOfFolder(cur);
    }
  }

  // 2. Depths; re-root whatever is past the limit (the first folder over it), until nothing is.
  let depth = new Map<string, number>();
  for (let pass = 0; pass <= folders.size; pass++) {
    depth = new Map();
    for (const id of ids) {
      const chain: string[] = [];
      let cur: string | null = id;
      while (cur !== null && !depth.has(cur)) {
        chain.push(cur);
        cur = parentOfFolder(cur);
      }
      let d = cur === null ? 0 : depth.get(cur)!;
      for (let i = chain.length - 1; i >= 0; i--) depth.set(chain[i], ++d);
    }
    const tooDeep = ids.filter((id) => depth.get(id)! === MAX_FOLDER_DEPTH + 1);
    if (tooDeep.length === 0) break;
    for (const id of tooDeep) forcedRoot.add(id);
  }

  const parent = new Map<string, string | null>();
  const children = new Map<string | null, string[]>();
  for (const e of byId.values()) {
    const p = e.type === "folder" ? parentOfFolder(e.id) : rawParent(e);
    parent.set(e.id, p);
    const list = children.get(p);
    if (list) list.push(e.id);
    else children.set(p, [e.id]);
  }
  return { byId, folders, parent, depth, children };
}

/** Folders above an entry, nearest first. [] at the top level (or if the entry isn't live). */
export function ancestorIds(view: FolderView, id: string): string[] {
  const out: string[] = [];
  let cur = view.parent.get(id) ?? null;
  while (cur !== null && out.length <= MAX_FOLDER_DEPTH) {
    out.push(cur);
    cur = view.parent.get(cur) ?? null;
  }
  return out;
}

/** The folder path to a folder, outermost first, including the folder itself. */
export function breadcrumbOf(view: FolderView, folderId: string): FolderNode[] {
  if (!view.folders.has(folderId)) return [];
  return [...ancestorIds(view, folderId)].reverse().concat(folderId).map((id) => view.folders.get(id)!);
}

/** "Work / Project X" for an entry's folder path ("" at the top level). */
export function folderPathLabel(view: FolderView, id: string): string {
  return [...ancestorIds(view, id)]
    .reverse()
    .map((f) => view.folders.get(f)!.title || "Untitled folder")
    .join(" / ");
}

export function childrenOf(view: FolderView, parentId: string | null): string[] {
  return view.children.get(parentId) ?? [];
}

/** Every entry anywhere under a folder (folders and items), not including the folder. */
export function descendantIds(view: FolderView, folderId: string): string[] {
  const out: string[] = [];
  const stack = [...childrenOf(view, folderId)];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    if (view.folders.has(id)) stack.push(...childrenOf(view, id));
  }
  return out;
}

/** How many folders deep this folder's own subfolders go: 1 for a folder with no subfolders. */
export function folderHeight(view: FolderView, folderId: string): number {
  let h = 1;
  for (const c of childrenOf(view, folderId)) {
    if (view.folders.has(c)) h = Math.max(h, 1 + folderHeight(view, c));
  }
  return h;
}

/** Direct contents of a folder (or the top level), counted by kind. */
export function countContents(view: FolderView, folderId: string | null): { folders: number; notes: number; todos: number; boards: number } {
  const n = { folders: 0, notes: 0, todos: 0, boards: 0 };
  for (const id of childrenOf(view, folderId)) {
    const t = view.byId.get(id)!.type;
    if (t === "folder") n.folders++;
    else if (t === "regular") n.notes++;
    else if (t === "todo") n.todos++;
    else if (t === "board") n.boards++;
  }
  return n;
}

export type MoveRefusal = "missing" | "not-a-folder" | "self" | "descendant" | "too-deep";
export type MoveCheck = { ok: true } | { ok: false; reason: MoveRefusal; id: string };

/** Can all of these entries go into `targetId` (null = top level)? Names the first one that can't, and why. */
export function canMove(view: FolderView, movingIds: readonly string[], targetId: string | null): MoveCheck {
  if (targetId !== null && !view.folders.has(targetId)) return { ok: false, reason: "not-a-folder", id: targetId };
  const targetAbove = targetId === null ? [] : [targetId, ...ancestorIds(view, targetId)];
  for (const id of movingIds) {
    const node = view.byId.get(id);
    if (!node) return { ok: false, reason: "missing", id };
    if (node.type !== "folder") continue; // entries that aren't folders have no depth
    if (id === targetId) return { ok: false, reason: "self", id };
    if (targetAbove.includes(id)) return { ok: false, reason: "descendant", id };
    const newDepth = (targetId === null ? 0 : view.depth.get(targetId)!) + 1;
    if (newDepth + folderHeight(view, id) - 1 > MAX_FOLDER_DEPTH) return { ok: false, reason: "too-deep", id };
  }
  return { ok: true };
}

export function refusalText(reason: MoveRefusal): string {
  switch (reason) {
    case "self":
      return "A folder can't go inside itself";
    case "descendant":
      return "A folder can't go inside one of its own subfolders";
    case "too-deep":
      return `Folders can only be nested ${MAX_FOLDER_DEPTH} deep`;
    case "not-a-folder":
      return "That folder no longer exists";
    default:
      return "That item no longer exists";
  }
}

/** Tags an entry carries: its own, then those of every folder above it (nearest folder first), each once. */
export function effectiveTags(view: FolderView, id: string): { own: string[]; inherited: { tag: string; from: string }[]; all: string[] } {
  const node = view.byId.get(id);
  const own = node ? node.tags : [];
  const seen = new Set(own);
  const inherited: { tag: string; from: string }[] = [];
  for (const f of ancestorIds(view, id)) {
    for (const tag of view.folders.get(f)!.tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      inherited.push({ tag, from: f });
    }
  }
  return { own, inherited, all: [...own, ...inherited.map((i) => i.tag)] };
}

export interface FolderDeletePlan {
  /** entries to move to the Trash (always includes the folder) */
  trashIds: string[];
  /** entries to re-file: where each goes instead of staying under the deleted folder */
  reparent: { id: string; parentId: string | null }[];
}

/**
 * "lift": only the folder is trashed; what was directly inside moves up one level (to the folder's own parent).
 * "all":  the folder and everything under it is trashed together.
 */
export function planFolderDelete(view: FolderView, folderId: string, mode: "lift" | "all"): FolderDeletePlan {
  if (!view.folders.has(folderId)) return { trashIds: [], reparent: [] };
  if (mode === "all") return { trashIds: [folderId, ...descendantIds(view, folderId)], reparent: [] };
  const up = view.parent.get(folderId) ?? null;
  return { trashIds: [folderId], reparent: childrenOf(view, folderId).map((id) => ({ id, parentId: up })) };
}
