<script lang="ts">
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";

  let {
    categories,
    currentCategory,
    onCategoryChange,
    onAddCategory,
    onRemoveCategory,
    onRenameCategory,
    progress = {},
  }: {
    categories: string[];
    currentCategory: string;
    onCategoryChange: (category: string) => void;
    onAddCategory: (category: string) => void;
    onRemoveCategory: (category: string) => void;
    // Round 34: rename the SELECTED category. Returns ok:false with a
    // message instead of throwing so the row can show why (empty / taken).
    onRenameCategory: (from: string, to: string) => { ok: true } | { ok: false; message: string };
    // Round 36: done/total per category. A category whose steps are ALL ticked
    // (and that has at least one) gets a check mark on its tab; others with
    // steps show how far along they are.
    progress?: Record<string, { done: number; total: number; allDone: boolean }>;
  } = $props();

  let isAdding = $state(false);
  let newCategory = $state("");
  // Round 34: rename row. Opened from the header's Rename button, always
  // for the currently selected category (so there is nothing to aim at on a
  // phone); `renameFrom` pins which one in case the selection changes while
  // the row is open.
  let isRenaming = $state(false);
  let renameFrom = $state("");
  let renameValue = $state("");
  let renameError = $state<string | null>(null);

  function startRename() {
    isAdding = false;
    renameFrom = currentCategory;
    renameValue = currentCategory;
    renameError = null;
    isRenaming = true;
  }

  function cancelRename() {
    isRenaming = false;
    renameError = null;
  }

  function commitRename() {
    const result = onRenameCategory(renameFrom, renameValue);
    if (result.ok) cancelRename();
    else renameError = result.message;
  }

  function renameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") cancelRename();
  }

  function commitAdd() {
    if (newCategory.trim()) {
      onAddCategory(newCategory.trim());
      newCategory = "";
      isAdding = false;
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter") commitAdd();
    if (e.key === "Escape") {
      isAdding = false;
      newCategory = "";
    }
  }

  // Round 35: the parent picks the next selection (see removeCategory in
  // todo/[id]/+page.svelte). This used to do it here, AFTER the removal, off
  // the already-shortened `categories` prop — with two categories that read as
  // "only one left, nothing to switch to" and left the editor on a dead tab.
  function remove(category: string) {
    onRemoveCategory(category);
  }
</script>

<div class="tabs-wrap">
  <div class="header">
    <span class="label">Sub-categories</span>
    <div class="header-actions">
      <Button size="sm" variant="outline" aria-label="Rename category" disabled={categories.length === 0} onclick={startRename}>
        Rename
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-label="Add category"
        onclick={() => {
          isRenaming = false;
          isAdding = !isAdding;
        }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add
      </Button>
    </div>
  </div>

  {#if isRenaming}
    <div class="add-row">
      <Input bind:value={renameValue} placeholder="Category name..." aria-label="Category name" onkeydown={renameKeydown} />
      <Button size="sm" aria-label="Save category name" onclick={commitRename}>Save</Button>
      <Button size="sm" variant="ghost" aria-label="Cancel rename" onclick={cancelRename}>Cancel</Button>
    </div>
    {#if renameError}
      <p class="rename-error" role="status">{renameError}</p>
    {/if}
  {/if}

  {#if isAdding}
    <div class="add-row">
      <Input bind:value={newCategory} placeholder="Category name..." aria-label="New category name" onkeydown={keydown} />
      <Button size="sm" aria-label="Save new category" onclick={commitAdd}>Save</Button>
    </div>
  {/if}

  {#if categories.length > 0}
    <!-- flex-wrap, not the original's CSS grid — on a phone-width screen
         a fixed-column grid of tab pills is exactly the kind of thing
         that forced horizontal scroll elsewhere in this app already;
         wrapping onto multiple rows avoids that class of bug entirely. -->
    <div class="tab-row">
      {#each categories as category (category)}
        <div class="tab-pill-wrap">
          <button
            class="tab-pill"
            class:active={currentCategory === category}
            class:all-done={progress[category]?.allDone}
            onclick={() => onCategoryChange(category)}
          >
            {#if progress[category]?.allDone}<span class="tick" aria-hidden="true">✓</span>{/if}
            {category}
            {#if progress[category] && progress[category].total > 0 && !progress[category].allDone}
              <span class="frac">{progress[category].done}/{progress[category].total}</span>
            {/if}
            {#if progress[category]?.allDone}<span class="sr-only"> — all steps done</span>{/if}
          </button>
          {#if categories.length > 1}
            <button class="remove" onclick={() => remove(category)} aria-label="Remove {category}">×</button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">No categories yet. Add one to get started!</div>
  {/if}
</div>

<style>
  .tabs-wrap {
    padding: var(--space-4);
    border-bottom: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .header-actions {
    display: flex;
    gap: var(--space-2);
  }
  .rename-error {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  .add-row {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
  }
  .tab-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .tab-pill-wrap {
    position: relative;
  }
  .tab-pill {
    font-size: 13px;
    padding: var(--space-2) var(--space-4);
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--text-lo);
    cursor: pointer;
  }
  .tab-pill.all-done {
    border-color: var(--accent);
  }
  .tick {
    font-weight: 700;
    color: var(--accent);
    margin-right: 2px;
  }
  .tab-pill.active .tick {
    color: var(--bg);
  }
  .frac {
    margin-left: 4px;
    font-size: 11px;
    opacity: 0.75;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .tab-pill.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .remove {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--danger);
    color: var(--text-hi);
    border: none;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }
  .empty {
    text-align: center;
    padding: var(--space-4) 0;
    font-size: 13px;
    color: var(--text-faint);
  }
</style>
