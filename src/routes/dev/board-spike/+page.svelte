<!--
  BOARDS SPIKE — throwaway, not the real feature.

  Purpose: answer exactly one question before committing to Boards at
  all — does @xyflow/svelte's touch handling (drag a node, pinch/pan
  the canvas, drag from a handle to draw a new connection) actually
  feel good on the real target device (Galaxy A13 WebView), or does it
  need a different library/approach. Nothing here is wired to Note/
  Todo/EntryRef, storage, lock, or theme — that's deliberate. The data
  model question (a new top-level entry type vs. a page-within-a-note
  type) and the interaction-scope question (freeform moodboard vs.
  something with directional/logical edges) both come AFTER this,
  once the touch feel itself is confirmed acceptable.

  Not linked from any nav — reach it by URL (/dev/board-spike) on a
  built/installed debug APK. Safe to delete this whole `dev/` folder
  (this file + TextNode.svelte + ImageNode.svelte) once Boards' real
  direction is decided, whichever way that goes.
-->
<script lang="ts">
  import { SvelteFlow, Background, BackgroundVariant, Controls, MiniMap, addEdge, type Node, type Edge, type Connection } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/base.css";
  import TextNode from "./TextNode.svelte";
  import ImageNode from "./ImageNode.svelte";

  const nodeTypes = {
    text: TextNode,
    image: ImageNode,
  };

  // Deliberately a small, mixed set — two text cards and two image
  // cards, one edge already drawn between two of them — enough to
  // judge drag/pan/zoom/connect feel without it being a real board.
  let nodes = $state.raw<Node[]>([
    { id: "1", type: "text", position: { x: 40, y: 40 }, data: { label: "Jasmine Badeem", body: "Protagonist — anti-villain arc" } },
    { id: "2", type: "image", position: { x: 260, y: 40 }, data: { label: "Character art" } },
    { id: "3", type: "text", position: { x: 40, y: 220 }, data: { label: "The Council", body: "Antagonist faction" } },
    { id: "4", type: "image", position: { x: 260, y: 220 }, data: { label: "Faction crest" } },
  ]);

  let edges = $state.raw<Edge[]>([{ id: "e1-2", source: "1", target: "2" }]);

  function handleConnect(connection: Connection) {
    edges = addEdge(connection, edges);
  }
</script>

<svelte:head>
  <title>Board spike (dev only)</title>
</svelte:head>

<div class="spike-page">
  <div class="spike-banner">Boards touch-feel spike — not a real feature. Drag a node, pinch/pan the canvas, drag from a handle to connect two nodes.</div>
  <div class="flow-wrap">
    <SvelteFlow bind:nodes bind:edges {nodeTypes} onconnect={handleConnect} fitView colorMode="dark" minZoom={0.3} maxZoom={2}>
      <Background variant={BackgroundVariant.Dots} gap={24} />
      <Controls />
      <MiniMap pannable zoomable />
    </SvelteFlow>
  </div>
</div>

<style>
  .spike-page {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg, #0a0e1f);
  }
  .spike-banner {
    padding: var(--space-3, 12px) var(--space-4, 16px);
    background: var(--surface-raised, #171d3a);
    color: var(--text-hi, #eef0fa);
    font-size: 13px;
    border-bottom: 1px solid var(--hairline, #262e52);
  }
  .flow-wrap {
    flex: 1;
    min-height: 0;
  }
  /* SvelteFlow renders its own full-size container; this just makes
     sure that container actually fills the flex row above rather than
     collapsing to 0 height, which base.css alone doesn't guarantee. */
  .flow-wrap :global(.svelte-flow) {
    width: 100%;
    height: 100%;
    background: var(--bg, #0a0e1f);
  }
  .flow-wrap :global(.svelte-flow__edge-path) {
    stroke: var(--accent-dim, #24397e);
    stroke-width: 2;
  }
  .flow-wrap :global(.svelte-flow__controls) {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }
  .flow-wrap :global(.svelte-flow__controls-button) {
    background: var(--surface, #10152b);
    border-bottom: 1px solid var(--hairline, #262e52);
    fill: var(--text-hi, #eef0fa);
  }
  .flow-wrap :global(.svelte-flow__minimap) {
    background: var(--surface, #10152b) !important;
  }
</style>
