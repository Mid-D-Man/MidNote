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
  import { SvelteFlow, Background, BackgroundVariant, Controls, addEdge, type Node, type Edge, type Connection, type Viewport } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/base.css";
  import { untrack } from "svelte";
  import TextNode from "./TextNode.svelte";
  import ImageNode from "./ImageNode.svelte";
  import BoardNodeEditSheet from "./BoardNodeEditSheet.svelte";
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
    flowEdges = untrack(() => boardEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
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
      edges: flowEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      viewport: currentViewport ? { x: currentViewport.x, y: currentViewport.y, zoom: currentViewport.zoom } : null,
    });
  }

  function handleConnect(connection: Connection) {
    flowEdges = addEdge(connection, flowEdges);
    emit();
  }

  // Node tap opens the edit sheet rather than xyflow's own selection
  // state doing anything visible — a board with no way to change a
  // node's text or pick a real image after creating it would be a
  // canvas you can rearrange but not actually use for anything.
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
  function handleNodeDelete() {
    if (!editingNodeId) return;
    const id = editingNodeId;
    flowNodes = flowNodes.filter((n) => n.id !== id);
    flowEdges = flowEdges.filter((e) => e.source !== id && e.target !== id);
    editingNodeId = null;
    emit();
  }

  export function addNode(kind: "text" | "image") {
    // Drop new nodes near the middle of whatever the viewport currently
    // shows, not at the graph origin — on a phone the origin is very
    // often scrolled completely off screen, which would look like the
    // button did nothing at all.
    const vp = currentViewport ?? { x: 0, y: 0, zoom: 1 };
    const cx = (-vp.x + 160) / vp.zoom;
    const cy = (-vp.y + 200) / vp.zoom;
    const id = crypto.randomUUID();
    flowNodes = [
      ...flowNodes,
      {
        id,
        type: kind,
        position: { x: cx + (Math.random() * 40 - 20), y: cy + (Math.random() * 40 - 20) },
        data: kind === "text" ? { label: "New node", body: null, customIconId: null } : { label: "Image", body: null, customIconId: null },
      },
    ];
    emit();
  }
</script>

<div class="canvas-wrap">
  <SvelteFlow
    bind:nodes={flowNodes}
    bind:edges={flowEdges}
    bind:viewport={currentViewport}
    {nodeTypes}
    onconnect={handleConnect}
    onnodeclick={handleNodeClick}
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

<BoardNodeEditSheet bind:open={editSheetOpen} node={editingBoardNode} onSave={handleNodeEditSave} onDelete={handleNodeDelete} />

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
