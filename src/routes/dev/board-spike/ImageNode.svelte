<!--
  Throwaway spike node — see +page.svelte's header comment. Stands in
  for what a real Boards "image" node would eventually be: a small
  card with a source-of-truth image and a caption, draggable, with a
  connection handle on each side. Not wired to any real data model —
  the image here is just the app's own logo asset, purely to test how
  an image-bearing node feels to drag/connect on a touch screen.
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  let { data, selected }: NodeProps & { data: { label: string } } = $props();
</script>

<div class="board-node board-node-image" class:selected>
  <Handle type="target" position={Position.Top} />
  <img src="/midnote-logo.svg" alt="" class="thumb" />
  <div class="caption">{data.label}</div>
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .board-node {
    width: 140px;
    border-radius: var(--radius-md, 12px);
    background: var(--surface, #10152b);
    border: 1px solid var(--hairline, #262e52);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    padding: var(--space-3, 8px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2, 4px);
    touch-action: none;
  }
  .board-node.selected {
    border-color: var(--accent, #5b7cff);
    box-shadow: 0 0 0 2px var(--accent, #5b7cff);
  }
  .thumb {
    width: 64px;
    height: 64px;
    object-fit: contain;
  }
  .caption {
    font-size: 13px;
    color: var(--text-hi, #eef0fa);
    text-align: center;
  }
</style>
