<script lang="ts">
  // Round 38 — opened when a line on the board is tapped: caption, arrow, remove.
  // (Lines are thin, so the same controls are also listed in each node's sheet.)
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import BoardConnectionRow from "./BoardConnectionRow.svelte";

  let {
    open = $bindable(false),
    edge,
    onLabel,
    onDirected,
    onRemove,
  }: {
    open?: boolean;
    edge: { id: string; summary: string; label: string | null; directed: boolean } | null;
    onLabel: (id: string, label: string) => void;
    onDirected: (id: string, directed: boolean) => void;
    onRemove: (id: string) => void;
  } = $props();
</script>

<Sheet bind:open side="bottom" title="Connection">
  {#if edge}
    <BoardConnectionRow
      id={edge.id}
      summary={edge.summary}
      label={edge.label}
      directed={edge.directed}
      {onLabel}
      {onDirected}
      onRemove={(id) => {
        onRemove(id);
        open = false;
      }}
    />
  {/if}
</Sheet>
