<!--
  Throwaway spike node — see +page.svelte's header comment. Stands in
  for what a real Boards "text" node would eventually be: a short
  note/label card, draggable, with a connection handle on each side.
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  let { data, selected }: NodeProps & { data: { label: string; body?: string } } = $props();
</script>

<div class="board-node board-node-text" class:selected>
  <Handle type="target" position={Position.Top} />
  <div class="label">{data.label}</div>
  {#if data.body}
    <div class="body">{data.body}</div>
  {/if}
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .board-node {
    width: 160px;
    border-radius: var(--radius-md, 12px);
    background: var(--surface, #10152b);
    border: 1px solid var(--hairline, #262e52);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    padding: var(--space-3, 8px) var(--space-4, 12px);
    touch-action: none;
  }
  .board-node.selected {
    border-color: var(--accent, #5b7cff);
    box-shadow: 0 0 0 2px var(--accent, #5b7cff);
  }
  .label {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-hi, #eef0fa);
  }
  .body {
    margin-top: var(--space-2, 4px);
    font-size: 12px;
    color: var(--text-lo, #9aa1c4);
    line-height: 1.4;
  }
</style>
