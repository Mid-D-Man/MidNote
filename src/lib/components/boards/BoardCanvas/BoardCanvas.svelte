<!--
  The board canvas itself. Deliberately the ONLY file in the app that
  imports @xyflow/svelte — everything else (storage, the list route, the
  board editor route) speaks MidNote's own BoardNode/BoardEdge types.
  That containment is on purpose: the library choice is still only
  spike-confirmed on one device, so if it ever has to be swapped out,
  this file is the whole blast radius and nothing persisted changes.

  Conversion happens in both directions here (toFlowNodes /
  fromFlowNodes): xyflow decorates its own node objects at runtime with
  measured dimensions, selection/drag state and internal handle
  bookkeeping, none of which is what a board MEANS and none of which
  should ever reach storage.
-->
<script lang="ts">
  import { SvelteFlow, Background, BackgroundVariant, Controls, MarkerType, addEdge, type Node, type Edge, type Connection, type Viewport } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/base.css";
  import { untrack, onDestroy } from "svelte";
  import TextNode from "./TextNode.svelte";
  import ImageNode from "./ImageNode.svelte";
  import BoardNodeEditSheet from "./BoardNodeEditSheet.svelte";
  import BoardEdgeSheet from "./BoardEdgeSheet.svelte";
  import { pushToast, dismissToast } from "$lib/stores/toast.svelte";
  import {
    nextNodePosition,
    removeNodeWithEdges,
    restoreNodeWithEdges,
    duplicateNode,
    updateEdge,
    removeEdge,
    restoreEdge,
    connectionsOf,
  } from "$lib/utils/boardEdits";
  import type { BoardNode, BoardEdge, BoardViewport } from "$lib/types/entry";

  let {
    nodes: boardNodes,
    edges: boardEdges,
    viewport: boardViewport,
    syncToken,
    onchange,
  }: {
    nodes: BoardNode[];
    edges: BoardEdge[];
    viewport: BoardViewport | null;
    // Bumped by the route's load() — see the $effect below for why this
    // canvas needs it at all, not just note-parity with syncToken's
    // other two uses in this app.
    syncToken: number;
    onchange: (next: { nodes: BoardNode[]; edges: BoardEdge[]; viewport: BoardViewport | null }) => void;
  } = $props();

  const nodeTypes = { text: TextNode, image: ImageNode };

  function toFlowNodes(source: BoardNode[]): Node[] {
    return source.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      data: { label: n.label, body: n.body, customIconId: n.customIconId },
    }));
  }

  function fromFlowNodes(source: Node[]): BoardNode[] {
    return source.map((n) => ({
      id: n.id,
      kind: n.type === "image" ? "image" : "text",
      x: n.position.x,
      y: n.position.y,
      label: (n.data?.label as string) ?? "",
      body: (n.data?.body as string | null) ?? null,
      customIconId: (n.data?.customIconId as string | null) ?? null,
    }));
  }

  // $state.raw, not $state: these arrays are handed wholesale to
  // SvelteFlow, which reassigns them rather than mutating in place.
  // Deep reactivity would mean proxying every node on every drag frame
  // for no benefit.
  // Round 38: a connection's caption is xyflow's own edge `label`; its arrow is a
  // closed arrowhead at the target end. `directed` rides along in `data` so the
  // flag survives the round trip (the marker alone is derived from it).
  function toFlowEdges(source: BoardEdge[]): Edge[] {
    return source.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label ?? undefined,
      data: { directed: e.directed === true },
      markerEnd: e.directed ? { type: MarkerType.ArrowClosed } : undefined,
    }));
  }

  function fromFlowEdges(source: Edge[]): BoardEdge[] {
    return source.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: typeof e.label === "string" && e.label.trim() ? e.label : null,
      directed: e.data?.directed === true,
    }));
  }

  let flowNodes = $state.raw<Node[]>([]);
  let flowEdges = $state.raw<Edge[]>([]);
  let currentViewport = $state.raw<Viewport | undefined>(undefined);

  // BUGFIX (the "go back in and it's reset" report): this used to seed
  // the three above ONCE, via untrack() at component creation — which
  // sounds like exactly the right "only seed at mount, then the canvas
  // owns its state" idea, but was wrong about WHEN mount actually
  // happens relative to load(). The board route's own `board` starts
  // as a blank createBoard() and only becomes the real saved entry
  // after load() runs inside onMount/an $effect — which fire AFTER the
  // initial render. Since this canvas isn't gated behind anything for
  // an already-unlocked board (unlike the locked case, which mounts
  // fresh only once already-decrypted), it mounts on that very first,
  // pre-load render and captured the still-blank board every time —
  // real data was already sitting in `board.nodes` a moment later, but
  // nothing here ever looked again.
  //
  // Fixed the exact way NoteContent.svelte's identical class of bug is
  // already fixed there: gate a re-seed on a syncToken the ROUTE bumps
  // specifically when load() finishes (see board/[id]/+page.svelte),
  // read via untrack() so this effect reacts ONLY to syncToken
  // changing — never to boardNodes/boardEdges/boardViewport changing on
  // their own, which happen on every drag/edit via handleCanvasChange's
  // mutation of the same `board` object, and would otherwise reset the
  // live canvas back to whatever was last persisted on every single
  // change this component itself just emitted.
  $effect(() => {
    syncToken;
    flowNodes = untrack(() => toFlowNodes(boardNodes));
    flowEdges = untrack(() => toFlowEdges(boardEdges));
    currentViewport = untrack(() =>
      boardViewport ? { x: boardViewport.x, y: boardViewport.y, zoom: boardViewport.zoom } : undefined,
    );
  });

  // One funnel for every mutation (drag, connect, viewport move) rather
  // than a $effect watching the arrays — an effect would also fire on
  // the initial load-in and immediately write the board back to storage
  // with a fresh lastModified, making every board look "just edited"
  // simply from being opened.
  function emit() {
    onchange({
      nodes: fromFlowNodes(flowNodes),
      edges: fromFlowEdges(flowEdges),
      viewport: currentViewport ? { x: currentViewport.x, y: currentViewport.y, zoom: currentViewport.zoom } : null,
    });
  }

  function handleConnect(connection: Connection) {
    // A new line starts plain; its caption and arrow are set from its sheet.
    const next = addEdge({ ...connection, data: { directed: false } }, flowEdges);
    if (next === flowEdges) return; // xyflow refuses a duplicate of an existing line
    flowEdges = next;
    emit();
  }

  // Node tap opens the edit sheet rather than xyflow's own selection
  // state doing anything visible — a board with no way to change a
  // node's text or pick a real image after creating it would be a
  // canvas you can rearrange but not actually use for anything.
  let canvasEl = $state<HTMLDivElement | null>(null);
  let editingNodeId = $state<string | null>(null);
  let editSheetOpen = $state(false);
  const editingBoardNode = $derived(editingNodeId ? fromFlowNodes(flowNodes).find((n) => n.id === editingNodeId) ?? null : null);

  function handleNodeClick({ node }: { node: Node }) {
    editingNodeId = node.id;
    editSheetOpen = true;
  }

  function handleNodeEditSave(patch: { label: string; body: string | null; customIconId: string | null }) {
    if (!editingNodeId) return;
    flowNodes = flowNodes.map((n) => (n.id === editingNodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    emit();
  }

  // Deleting a node has to also drop every edge that referenced it —
  // otherwise fromFlowNodes/the persisted board would carry an edge
  // pointing at a node id that no longer exists, which BoardHeader's
  // duplicate-id-remapping and every future consumer would then have to
  // defensively handle instead of this being the one place it's
  // actually prevented.
  // Round 38: every destructive edit here offers Undo (same pattern as the todo
  // editor). The toast goes away with the canvas — an Undo that outlived the
  // board page would write a stale copy back over whatever changed since.
  let undoToastId: string | null = null;
  function offerUndo(title: string, run: () => void) {
    if (undoToastId) dismissToast(undoToastId);
    undoToastId = pushToast({ title, action: { label: "Undo", run: () => { undoToastId = null; run(); } }, durationMs: 8000 });
  }
  onDestroy(() => {
    if (undoToastId) dismissToast(undoToastId);
  });

  function handleNodeDelete() {
    if (!editingNodeId) return;
    const plan = removeNodeWithEdges(fromFlowNodes(flowNodes), fromFlowEdges(flowEdges), editingNodeId);
    editingNodeId = null;
    if (!plan) return;
    const keepNodes = new Set(plan.nodes.map((n) => n.id));
    flowNodes = flowNodes.filter((n) => keepNodes.has(n.id));
    const keepEdges = new Set(plan.edges.map((e) => e.id));
    flowEdges = flowEdges.filter((e) => keepEdges.has(e.id));
    emit();
    const lines = plan.undo.edges.length;
    offerUndo(lines > 0 ? `Node deleted with ${lines} connection${lines === 1 ? "" : "s"}` : "Node deleted", () => {
      const back = restoreNodeWithEdges(fromFlowNodes(flowNodes), fromFlowEdges(flowEdges), plan.undo);
      const restoredNode = back.nodes.find((n) => n.id === plan.undo.node.item.id);
      if (restoredNode && !flowNodes.some((n) => n.id === restoredNode.id)) {
        const at = Math.min(plan.undo.node.index, flowNodes.length);
        const flow = toFlowNodes([restoredNode])[0];
        flowNodes = [...flowNodes.slice(0, at), flow, ...flowNodes.slice(at)];
      }
      flowEdges = toFlowEdges(back.edges);
      emit();
    });
  }

  function handleNodeDuplicate() {
    if (!editingNodeId) return;
    const newId = crypto.randomUUID();
    const next = duplicateNode(fromFlowNodes(flowNodes), editingNodeId, newId);
    if (!next) return;
    const added = next[next.length - 1];
    flowNodes = [...flowNodes, ...toFlowNodes([added])];
    emit();
  }

  // The lines attached to the node being edited, for its sheet.
  const editingConnections = $derived(editingNodeId ? connectionsOf(fromFlowNodes(flowNodes), fromFlowEdges(flowEdges), editingNodeId) : []);

  function handleEdgeLabel(id: string, label: string) {
    const next = updateEdge(fromFlowEdges(flowEdges), id, { label });
    if (!next) return;
    flowEdges = toFlowEdges(next);
    emit();
  }

  function handleEdgeDirected(id: string, directed: boolean) {
    const next = updateEdge(fromFlowEdges(flowEdges), id, { directed });
    if (!next) return;
    flowEdges = toFlowEdges(next);
    emit();
  }

  function handleEdgeRemove(id: string) {
    const plan = removeEdge(fromFlowEdges(flowEdges), id);
    if (!plan) return;
    flowEdges = toFlowEdges(plan.edges);
    emit();
    offerUndo("Connection removed", () => {
      flowEdges = toFlowEdges(restoreEdge(fromFlowNodes(flowNodes), fromFlowEdges(flowEdges), plan.undo));
      emit();
    });
  }

  // Tapping a line itself.
  let editingEdgeId = $state<string | null>(null);
  let edgeSheetOpen = $state(false);
  const editingEdge = $derived.by(() => {
    if (!editingEdgeId) return null;
    const e = fromFlowEdges(flowEdges).find((x) => x.id === editingEdgeId);
    if (!e) return null;
    const names = new Map(fromFlowNodes(flowNodes).map((n) => [n.id, n.label || "Untitled"]));
    return { id: e.id, summary: `${names.get(e.source) ?? "Untitled"} → ${names.get(e.target) ?? "Untitled"}`, label: e.label, directed: e.directed };
  });

  function handleEdgeClick({ edge }: { edge: Edge }) {
    editingEdgeId = edge.id;
    edgeSheetOpen = true;
  }

  // Keyboard / selection deletes handled by xyflow itself never went through emit(),
  // so a deleted node or line came back after reopening the board.
  function handleXyflowDelete() {
    emit();
  }

  export function addNode(kind: "text" | "image") {
    // Drop new nodes near the middle of whatever the viewport currently
    // shows, not at the graph origin — on a phone the origin is very
    // often scrolled completely off screen, which would look like the
    // button did nothing at all.
    const vp = currentViewport ?? { x: 0, y: 0, zoom: 1 };
    // The middle of what's on screen (not a fixed screen offset), nudged clear of
    // any node already there so repeated adds don't stack. A node's origin is its
    // top-left, so aim a little up-left of centre to land it visually centred.
    const w = canvasEl?.clientWidth || 360;
    const h = canvasEl?.clientHeight || 600;
    const center = { x: (w / 2 - vp.x) / vp.zoom - 75, y: (h / 2 - vp.y) / vp.zoom - 30 };
    const pos = nextNodePosition(flowNodes.map((n) => n.position), center);
    const id = crypto.randomUUID();
    flowNodes = [
      ...flowNodes,
      {
        id,
        type: kind,
        position: pos,
        data: kind === "text" ? { label: "New node", body: null, customIconId: null } : { label: "Image", body: null, customIconId: null },
      },
    ];
    emit();
  }
</script>

<div class="canvas-wrap" bind:this={canvasEl}>
  <SvelteFlow
    bind:nodes={flowNodes}
    bind:edges={flowEdges}
    bind:viewport={currentViewport}
    {nodeTypes}
    onconnect={handleConnect}
    onnodeclick={handleNodeClick}
    onedgeclick={handleEdgeClick}
    ondelete={handleXyflowDelete}
    onnodedragstop={emit}
    onmoveend={emit}
    fitView={!boardViewport}
    colorMode="dark"
    minZoom={0.2}
    maxZoom={2.5}
    attributionPosition="bottom-left"
    proOptions={{ hideAttribution: true }}
  >
    <Background variant={BackgroundVariant.Dots} gap={24} />
    <Controls showLock={false} />
  </SvelteFlow>
</div>

<!-- The "Svelte Flow" badge was the library's own attribution, not
     something MidNote added — it rendered by default on every flow.
     Round 21 only repositioned it (bottom-left, opposite Controls)
     rather than hiding it outright, since @xyflow/svelte's core is
     MIT-licensed (legally free to hide) but the maintainers explicitly
     ask it only be removed by Svelte Flow Pro subscribers
     (svelteflow.dev/attribution) — left as CLAUDEcode's call rather than
     made silently. Round 22: CLAUDEcode asked for it gone, so
     `proOptions={{ hideAttribution: true }}` above now hides it — an
     informed choice now made, not a default snuck in. -->

<BoardNodeEditSheet
  bind:open={editSheetOpen}
  node={editingBoardNode}
  onSave={handleNodeEditSave}
  onDelete={handleNodeDelete}
  onDuplicate={handleNodeDuplicate}
  connections={editingConnections}
  onEdgeLabel={handleEdgeLabel}
  onEdgeDirected={handleEdgeDirected}
  onEdgeRemove={handleEdgeRemove}
/>
<BoardEdgeSheet bind:open={edgeSheetOpen} edge={editingEdge} onLabel={handleEdgeLabel} onDirected={handleEdgeDirected} onRemove={handleEdgeRemove} />

<!-- xyflow draws a caption in a small box; match the app's surfaces instead of its light default. -->

<style>
  .canvas-wrap {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .canvas-wrap :global(.svelte-flow) {
    width: 100%;
    height: 100%;
    background: transparent;
  }
  .canvas-wrap :global(.svelte-flow__edge-path) {
    stroke: var(--accent-dim);
    stroke-width: 2;
  }
  .canvas-wrap :global(.svelte-flow__edge-text) {
    fill: var(--text-hi);
    font-size: 12px;
  }
  .canvas-wrap :global(.svelte-flow__edge-textbg) {
    fill: var(--surface-raised);
  }
  .canvas-wrap :global(.svelte-flow__arrowhead polyline),
  .canvas-wrap :global(.svelte-flow__arrowhead path) {
    stroke: var(--accent-dim);
    fill: var(--accent-dim);
  }
  .canvas-wrap :global(.svelte-flow__controls) {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }
  .canvas-wrap :global(.svelte-flow__controls-button) {
    background: var(--surface);
    border-bottom: 1px solid var(--hairline);
    fill: var(--text-hi);
  }
  .canvas-wrap :global(.svelte-flow__controls-button:hover) {
    background: var(--surface-raised);
  }
</style>
