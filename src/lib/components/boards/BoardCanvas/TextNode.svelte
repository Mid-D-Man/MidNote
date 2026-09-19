<!--
  A board's text node. Rendered by BoardCanvas via its nodeTypes map;
  `data` is whatever BoardCanvas's toFlowNodes put there, which mirrors
  BoardNode's own fields rather than any xyflow-specific shape.
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  let { data, selected }: NodeProps & { data: { label: string; body: string | null } } = $props();
</script>

<div class="board-node" class:selected>
  <Handle type="target" position={Position.Top} />
  <div class="label">{data.label || "Untitled"}</div>
  {#if data.body}
    <div class="body">{data.body}</div>
  {/if}
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .board-node {
    width: 150px;
    border-radius: var(--radius-md);
    background: var(--surface);
    border: 1px solid var(--hairline);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    padding: var(--space-3) var(--space-4);
    /* Without this the browser claims the drag as a scroll gesture on
       touch and the node never moves — the single most important line
       in this file for the phone case. */
    touch-action: none;
  }
  .board-node.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .label {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-hi);
    overflow-wrap: anywhere;
  }
  .body {
    margin-top: var(--space-2);
    font-size: 12px;
    color: var(--text-lo);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
</style>
