// Round 38 — the pure edits behind the board canvas polish: where a new node
// lands, deleting a node (with its connections) and getting it back, duplicating
// a node, and editing a connection. No Svelte, no xyflow: BoardCanvas applies the
// results, and every decision that can go wrong lives here where it is tested.
import type { BoardEdge, BoardNode } from "$lib/types/entry";

export type XY = { x: number; y: number };

/** How close two node origins may be before they count as "on top of each other" (a node is ~150px wide). */
export const NODE_CLEARANCE = 110;

/**
 * Where a new node should go: the middle of what's on screen, unless a node is
 * already there — then the nearest free spot, found by walking outwards in a
 * ring. Before this, every new node appeared at the same screen position (plus a
 * few random pixels), so adding several left a pile that couldn't be told apart.
 */
export function nextNodePosition(existing: readonly XY[], center: XY, clearance = NODE_CLEARANCE): XY {
  const free = (p: XY) => existing.every((n) => Math.hypot(n.x - p.x, n.y - p.y) >= clearance);
  if (free(center)) return { x: Math.round(center.x), y: Math.round(center.y) };
  const step = clearance;
  for (let ring = 1; ring <= 12; ring++) {
    const r = ring * step;
    const points = Math.max(8, ring * 8);
    for (let i = 0; i < points; i++) {
      const a = (2 * Math.PI * i) / points;
      const p = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
      if (free(p)) return { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
  // 12 rings of full ring-space (hundreds of nodes) — place far to the side rather than loop forever.
  return { x: Math.round(center.x + 13 * step), y: Math.round(center.y) };
}

export type NodeRemoval = {
  nodes: BoardNode[];
  edges: BoardEdge[];
  undo: { node: { item: BoardNode; index: number }; edges: { item: BoardEdge; index: number }[] };
};

/** Delete a node and every connection touching it. null (nothing changes) for an unknown id. */
export function removeNodeWithEdges(nodes: readonly BoardNode[], edges: readonly BoardEdge[], id: string): NodeRemoval | null {
  const ni = nodes.findIndex((n) => n.id === id);
  if (ni === -1) return null;
  const removedEdges: { item: BoardEdge; index: number }[] = [];
  const keptEdges: BoardEdge[] = [];
  edges.forEach((e, index) => {
    if (e.source === id || e.target === id) removedEdges.push({ item: e, index });
    else keptEdges.push(e);
  });
  return {
    nodes: nodes.filter((n) => n.id !== id),
    edges: keptEdges,
    undo: { node: { item: nodes[ni], index: ni }, edges: removedEdges },
  };
}

/**
 * Undo of removeNodeWithEdges: the node and its connections back at their old
 * places. A connection is only restored if BOTH of its ends exist — if the other
 * end was deleted in the meantime the connection would dangle, so it stays gone.
 */
export function restoreNodeWithEdges(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  undo: NodeRemoval["undo"]
): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const outNodes = nodes.some((n) => n.id === undo.node.item.id) ? [...nodes] : insertAt(nodes, undo.node.item, undo.node.index);
  const have = new Set(outNodes.map((n) => n.id));
  let outEdges = [...edges];
  for (const r of [...undo.edges].sort((a, b) => a.index - b.index)) {
    if (!have.has(r.item.source) || !have.has(r.item.target)) continue;
    if (outEdges.some((e) => e.id === r.item.id)) continue;
    outEdges = insertAt(outEdges, r.item, r.index);
  }
  return { nodes: outNodes, edges: outEdges };
}

function insertAt<T>(list: readonly T[], item: T, index: number): T[] {
  const out = [...list];
  out.splice(Math.min(Math.max(0, index), out.length), 0, item);
  return out;
}

/** A copy of node `id` under `newId`, nudged down-right so it doesn't hide the original. Connections are NOT copied. null for an unknown id. */
export function duplicateNode(nodes: readonly BoardNode[], id: string, newId: string, offset: XY = { x: 40, y: 40 }): BoardNode[] | null {
  const src = nodes.find((n) => n.id === id);
  if (!src) return null;
  return [...nodes, { ...src, id: newId, x: Math.round(src.x + offset.x), y: Math.round(src.y + offset.y) }];
}

export const MAX_EDGE_LABEL = 40;

export function cleanEdgeLabel(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_EDGE_LABEL).trim() || null : null;
}

/** Change an edge's label and/or arrow. null (nothing changes) for an unknown id. */
export function updateEdge(edges: readonly BoardEdge[], id: string, patch: { label?: string | null; directed?: boolean }): BoardEdge[] | null {
  const i = edges.findIndex((e) => e.id === id);
  if (i === -1) return null;
  return edges.map((e, k) =>
    k === i
      ? {
          ...e,
          label: patch.label === undefined ? e.label : cleanEdgeLabel(patch.label),
          directed: patch.directed === undefined ? e.directed : patch.directed === true,
        }
      : e
  );
}

export type EdgeRemoval = { edges: BoardEdge[]; undo: { item: BoardEdge; index: number } };

export function removeEdge(edges: readonly BoardEdge[], id: string): EdgeRemoval | null {
  const i = edges.findIndex((e) => e.id === id);
  if (i === -1) return null;
  return { edges: edges.filter((e) => e.id !== id), undo: { item: edges[i], index: i } };
}

export function restoreEdge(nodes: readonly BoardNode[], edges: readonly BoardEdge[], undo: EdgeRemoval["undo"]): BoardEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(undo.item.source) || !ids.has(undo.item.target) || edges.some((e) => e.id === undo.item.id)) return [...edges];
  return insertAt(edges, undo.item, undo.index);
}

export type Connection = { id: string; otherId: string; otherLabel: string; outgoing: boolean; label: string | null; directed: boolean };

/** Every connection touching `nodeId`, described from that node's point of view. */
export function connectionsOf(nodes: readonly BoardNode[], edges: readonly BoardEdge[], nodeId: string): Connection[] {
  const nameOf = new Map(nodes.map((n) => [n.id, n.label || "Untitled"]));
  const out: Connection[] = [];
  for (const e of edges) {
    if (e.source !== nodeId && e.target !== nodeId) continue;
    const outgoing = e.source === nodeId;
    const otherId = outgoing ? e.target : e.source;
    out.push({ id: e.id, otherId, otherLabel: nameOf.get(otherId) ?? "Untitled", outgoing, label: e.label ?? null, directed: e.directed === true });
  }
  return out;
}

/** Plain-language line for a connection, shared by the text export and read-aloud. */
export function describeEdge(fromName: string, toName: string, label: string | null | undefined, directed: boolean | undefined, style: "text" | "speech"): string {
  const l = label?.trim();
  if (style === "text") return `${fromName} ${directed ? "->" : "--"} ${toName}${l ? ` (${l})` : ""}`;
  const verb = directed ? "points to" : "connects to";
  return `${fromName} ${verb} ${toName}${l ? `, ${l}` : ""}`;
}

// ---- Dropping a dragged line on empty space ----
// Drag from a node's handle and let go on empty canvas: the board offers to make a text or an image node right there,
// already joined to the node the line came from. These are the decisions behind that, kept pure so they are tested.

/** Rough size of a node on the board (px at zoom 1), to centre a dropped node on the finger and to put it on the right side of it. */
export const DROP_NODE_SIZE = { text: { w: 150, h: 56 }, image: { w: 130, h: 120 } } as const;

/** A point on the screen -> the same point on the board, given the canvas's top-left corner and the current pan/zoom. */
export function screenToBoard(client: XY, canvasTopLeft: XY, vp: { x: number; y: number; zoom: number }): XY {
  const zoom = vp.zoom > 0 ? vp.zoom : 1;
  return { x: (client.x - canvasTopLeft.x - vp.x) / zoom, y: (client.y - canvasTopLeft.y - vp.y) / zoom };
}

/**
 * Where the little menu goes (top-left, in canvas pixels): centred on the point and ABOVE it so a finger doesn't cover it,
 * or just below when there's no room above, and always fully inside the canvas.
 */
export function menuPlacement(point: XY, menu: { w: number; h: number }, bounds: { w: number; h: number }, gap = 16, margin = 8): XY {
  const maxLeft = Math.max(margin, bounds.w - menu.w - margin);
  const left = Math.min(Math.max(point.x - menu.w / 2, margin), maxLeft);
  const above = point.y - gap - menu.h;
  const maxTop = Math.max(margin, bounds.h - menu.h - margin);
  const top = above >= margin ? above : Math.min(point.y + gap, maxTop);
  return { x: Math.round(left), y: Math.round(top) };
}

/**
 * The node (and the line to it) for a drop at board position `at`. `fromIsSource` is whether the line was dragged out of the
 * node's source (bottom) handle: then the new node hangs below the drop point and the line runs from the old node to the new
 * one. Dragged out of a target (top) handle it is the other way round: the new node sits above the drop point and the line
 * runs from it into the old node. Either way the new node is centred on the drop point, and the line is plain.
 */
export function droppedNode(
  kind: "text" | "image",
  at: XY,
  fromNodeId: string,
  fromIsSource: boolean,
  ids: { node: string; edge: string },
): { node: BoardNode; edge: BoardEdge } {
  const size = DROP_NODE_SIZE[kind];
  const node: BoardNode = {
    id: ids.node,
    kind,
    x: Math.round(at.x - size.w / 2),
    y: Math.round(fromIsSource ? at.y : at.y - size.h),
    label: kind === "text" ? "New node" : "Image",
    body: null,
    customIconId: null,
  };
  const edge: BoardEdge = {
    id: ids.edge,
    source: fromIsSource ? fromNodeId : ids.node,
    target: fromIsSource ? ids.node : fromNodeId,
    label: null,
    directed: false,
  };
  return { node, edge };
}
