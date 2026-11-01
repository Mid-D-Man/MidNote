// Where to put the nodes of a board the AI wrote. The AI gives ideas and arrows, never coordinates (a model is bad at
// those), so the app lays them out: arrows run top to bottom (a node's output dot is at the bottom, its input at the
// top), each node sits one row below the deepest node that points at it, and a row that is too wide wraps. Plain
// TypeScript, no Svelte.

export const LAYOUT = { colGap: 190, rowGap: 110, maxPerRow: 3, margin: 40 } as const;

export interface Placed {
  x: number;
  y: number;
}

/**
 * Positions for `keys` (in the order given), by the arrows `links` (from -> to, by key). Arrows that would make a loop
 * are ignored for the layout only (they are still drawn). Keys not in `keys` are ignored.
 */
export function layoutBoard(keys: readonly string[], links: readonly { from: string; to: string }[]): Map<string, Placed> {
  const index = new Map<string, number>();
  keys.forEach((k, i) => index.set(k, i));
  const out: number[][] = keys.map(() => []);
  const hasIn = keys.map(() => false);
  for (const l of links) {
    const a = index.get(l.from);
    const b = index.get(l.to);
    if (a === undefined || b === undefined || a === b) continue;
    out[a].push(b);
    hasIn[b] = true;
  }

  // Depth-first from the nodes nothing points at (then from any node not reached, so a loop still gets placed),
  // leaving out the arrows that run back to a node still being visited.
  const state = keys.map(() => 0); // 0 new, 1 in progress, 2 done
  const forward: number[][] = keys.map(() => []);
  const visit = (start: number) => {
    const stack: { n: number; i: number }[] = [{ n: start, i: 0 }];
    state[start] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < out[top.n].length) {
        const m = out[top.n][top.i++];
        if (state[m] === 1) continue; // back arrow: ignored for the layout
        forward[top.n].push(m);
        if (state[m] === 0) {
          state[m] = 1;
          stack.push({ n: m, i: 0 });
        }
      } else {
        state[top.n] = 2;
        stack.pop();
      }
    }
  };
  for (let i = 0; i < keys.length; i++) if (!hasIn[i] && state[i] === 0) visit(i);
  for (let i = 0; i < keys.length; i++) if (state[i] === 0) visit(i);

  // longest path from the top over the forward arrows (they have no loops), in topological order
  const indeg = keys.map(() => 0);
  forward.forEach((ms) => ms.forEach((m) => indeg[m]++));
  const depth = keys.map(() => 0);
  const queue: number[] = [];
  indeg.forEach((d, i) => d === 0 && queue.push(i));
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q];
    for (const m of forward[n]) {
      // nodes leave the queue in order of depth, so the last parent to be visited is the deepest one
      depth[m] = depth[n] + 1;
      if (--indeg[m] === 0) queue.push(m);
    }
  }

  const layers: number[][] = [];
  keys.forEach((_, i) => (layers[depth[i]] ??= []).push(i));

  const raw = new Map<string, Placed>();
  let row = 0;
  for (const layer of layers) {
    if (!layer || layer.length === 0) continue;
    for (let start = 0; start < layer.length; start += LAYOUT.maxPerRow) {
      const slice = layer.slice(start, start + LAYOUT.maxPerRow);
      slice.forEach((n, c) => raw.set(keys[n], { x: (c - (slice.length - 1) / 2) * LAYOUT.colGap, y: row * LAYOUT.rowGap }));
      row++;
    }
  }

  // shift so everything is at positive coordinates with a margin
  let minX = Infinity;
  for (const p of raw.values()) minX = Math.min(minX, p.x);
  const placed = new Map<string, Placed>();
  for (const [k, p] of raw) placed.set(k, { x: Math.round(p.x - minX + LAYOUT.margin), y: Math.round(p.y + LAYOUT.margin) });
  return placed;
}

export interface DraftBoard {
  nodes: readonly { key: string; label: string; body: string }[];
  links: readonly { from: string; to: string }[];
}

/**
 * The nodes and edges of a board entry for what the AI wrote: plain text nodes at the laid-out spots, and an arrow for
 * every link (from -> to, so the arrowhead is on the node that follows). `newId` makes the ids.
 */
export function boardParts(d: DraftBoard, newId: () => string) {
  const spots = layoutBoard(d.nodes.map((n) => n.key), d.links);
  const ids = new Map<string, string>();
  const nodes = d.nodes.map((n) => {
    const id = newId();
    ids.set(n.key, id);
    const at = spots.get(n.key) ?? { x: LAYOUT.margin, y: LAYOUT.margin };
    return { id, kind: "text" as const, x: at.x, y: at.y, label: n.label, body: n.body || null, customIconId: null };
  });
  const edges = d.links.map((l) => ({ id: newId(), source: ids.get(l.from) as string, target: ids.get(l.to) as string, label: null, directed: true }));
  return { nodes, edges };
}
