<!--
  A board's image node. The image itself is NOT stored on the node —
  `customIconId` points into the existing CustomIcon registry (see
  storage.ts's storeCustomIconImage), deliberately reusing that
  upload/center-crop/downscale path rather than introducing a third
  image store alongside custom themes and custom icons. A null id, or
  an id whose upload has since been deleted, renders as the empty
  placeholder tile below rather than a broken image or a thrown error —
  same dangling-reference tolerance resolveIcon() already has.
-->
<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { customIcons } from "$lib/stores/customIcons.svelte";

  let { data, selected }: NodeProps & { data: { label: string; customIconId: string | null } } = $props();

  const image = $derived(data.customIconId ? (customIcons.find((c) => c.id === data.customIconId)?.data ?? null) : null);
</script>

<div class="board-node" class:selected>
  <Handle type="target" position={Position.Top} />
  {#if image}
    <img src={image} alt="" class="thumb" />
  {:else}
    <div class="thumb placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </div>
  {/if}
  <div class="label">{data.label || "Image"}</div>
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .board-node {
    width: 130px;
    border-radius: var(--radius-md);
    background: var(--surface);
    border: 1px solid var(--hairline);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    /* See TextNode.svelte's identical comment — required for touch drag. */
    touch-action: none;
  }
  .board-node.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .thumb {
    width: 72px;
    height: 72px;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }
  .thumb.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-raised);
    color: var(--text-faint);
  }
  .label {
    font-size: 12px;
    color: var(--text-hi);
    text-align: center;
    overflow-wrap: anywhere;
  }
</style>
