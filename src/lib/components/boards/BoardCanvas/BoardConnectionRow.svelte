<script lang="ts">
  // Round 38 — one connection of a board, editable: its caption, whether it has an
  // arrowhead, and remove. Used twice: inside a node's edit sheet (every
  // connection of that node, which is the easy way to reach a thin line on a
  // phone) and in the sheet that opens when a line itself is tapped.
  //
  // The caption is committed on Enter or when the field loses focus, not on
  // every keystroke — each commit re-saves the whole board.
  import { MAX_EDGE_LABEL } from "$lib/utils/boardEdits";

  let {
    id,
    summary,
    label,
    directed,
    onLabel,
    onDirected,
    onRemove,
  }: {
    id: string;
    // e.g. "Queen" for a node's list (the other end), or "King → Queen" when the line itself was tapped.
    summary: string;
    label: string | null;
    directed: boolean;
    onLabel: (id: string, label: string) => void;
    onDirected: (id: string, directed: boolean) => void;
    onRemove: (id: string) => void;
  } = $props();

  let draft = $state("");
  let seededFor = $state<string | null>(null);
  $effect(() => {
    // re-seed when a different connection is shown, not on every save of this one
    if (seededFor !== id) {
      draft = label ?? "";
      seededFor = id;
    }
  });

  function commit() {
    if (draft.trim() === (label ?? "")) return;
    onLabel(id, draft);
  }
</script>

<div class="row">
  <div class="top">
    <span class="summary">{summary}</span>
    <button type="button" class="remove" aria-label={`Remove connection ${summary}`} onclick={() => onRemove(id)}>Remove</button>
  </div>
  <div class="controls">
    <input
      type="text"
      class="caption"
      placeholder="Caption (optional)"
      maxlength={MAX_EDGE_LABEL}
      aria-label={`Caption for ${summary}`}
      bind:value={draft}
      onblur={commit}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
    <label class="arrow">
      <input type="checkbox" checked={directed} aria-label={`Arrow on ${summary}`} onchange={(e) => onDirected(id, (e.currentTarget as HTMLInputElement).checked)} />
      <span>Arrow</span>
    </label>
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .summary {
    font-size: 14px;
    color: var(--text-hi);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .remove {
    flex-shrink: 0;
    min-height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--danger);
    font-size: 13px;
    cursor: pointer;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .caption {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 var(--space-3);
    background: var(--bg);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 14px;
  }
  .arrow {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--text-lo);
  }
  .arrow input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
</style>
