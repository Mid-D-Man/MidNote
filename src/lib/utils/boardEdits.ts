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
