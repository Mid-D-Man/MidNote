<script lang="ts">
  // Settings -> Actions. The order of the rows in the Actions sheet of a note, a todo and a board: move a row up or down, or go
  // back to the default order. A todo or a board shows the same order without the actions it doesn't have. State is written
  // from click handlers only (stores/actionOrder.svelte.ts).
  import { actionOrder, moveActionRow, resetActionOrder } from "$lib/stores/actionOrder.svelte";
  import { ACTION_LABELS, isDefaultOrder, NOTE_ACTIONS, TODO_ACTIONS, BOARD_ACTIONS } from "$lib/utils/actionOrder";
  import { breadcrumb } from "$lib/debug/log.svelte";

  const atDefault = $derived(isDefaultOrder(actionOrder.value));
  const last = $derived(actionOrder.value.length - 1);

  /** Which kinds of entry have an action: "Notes only", "Notes and todos", ... (blank when all three have it). */
  function whoHas(id: (typeof actionOrder.value)[number]): string {
    const kinds = [
      NOTE_ACTIONS.includes(id) ? "notes" : null,
      TODO_ACTIONS.includes(id) ? "todos" : null,
      BOARD_ACTIONS.includes(id) ? "boards" : null,
    ].filter((k): k is string => k !== null);
    if (kinds.length === 3) return "";
    const text = kinds.join(" and ");
    return text.charAt(0).toUpperCase() + text.slice(1) + (kinds.length === 1 ? " only" : "");
  }
</script>

<p class="lead">The order of the Actions list in a note, a todo and a board. Move the ones you use most to the top.</p>

<ol class="rows" aria-label="Actions order">
  {#each actionOrder.value as id, i (id)}
    <li class="row">
      <span class="num" aria-hidden="true">{i + 1}</span>
      <span class="name">
        <span class="label">{ACTION_LABELS[id]}</span>
        {#if whoHas(id)}<span class="who">{whoHas(id)}</span>{/if}
      </span>
      <button
        type="button"
        class="move"
        aria-label="Move {ACTION_LABELS[id]} up"
        disabled={i === 0}
        onclick={() => {
          breadcrumb(`settings: action ${id} moved up`);
          moveActionRow(id, -1);
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15" /></svg>
      </button>
      <button
        type="button"
        class="move"
        aria-label="Move {ACTION_LABELS[id]} down"
        disabled={i === last}
        onclick={() => {
          breadcrumb(`settings: action ${id} moved down`);
          moveActionRow(id, 1);
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </li>
  {/each}
</ol>

<button
  type="button"
  class="reset"
  disabled={atDefault}
  onclick={() => {
    breadcrumb("settings: actions order reset");
    resetActionOrder();
  }}
>
  Reset to default order
</button>

<style>
  .lead {
    margin: 0 0 var(--space-4);
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-lo);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 48px;
    padding: 0 var(--space-2) 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .num {
    width: 20px;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-faint);
    text-align: right;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .label {
    font-size: 14px;
    color: var(--text-hi);
  }
  .who {
    font-size: 11px;
    color: var(--text-faint);
  }
  .move {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    color: var(--text-lo);
    background: transparent;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }
  .move:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .reset {
    margin-top: var(--space-4);
    min-height: 44px;
    padding: 0 var(--space-4);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .reset:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
