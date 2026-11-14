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

  // Keeps the selected chip inside the strip's window (the strip scrolls, so the selection could be out of sight).
  // An action, not an effect: it runs when the chip appears and whenever `active` changes.
  function reveal(node: HTMLElement, active: boolean) {
    const run = (isActive: boolean) => {
      const box = node.parentElement;
      if (!isActive || !box) return;
      if (node.offsetTop < box.scrollTop) box.scrollTop = node.offsetTop;
      else if (node.offsetTop + node.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = node.offsetTop + node.offsetHeight - box.clientHeight;
    };
    run(active);
    return { update: run };
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
    <!-- The same shape as the landing page's tag list: chips in a window of fixed height (about two rows) that scrolls
         inside itself, so a long list of categories never pushes the steps down the screen. A long name is cut with an
         ellipsis (the full name is the heading below the strip, and the chip's title). The remove "x" sits inside the chip. -->
    <div class="tab-row">
      {#each categories as category (category)}
        <div
          class="tab-pill-wrap"
          class:active={currentCategory === category}
          class:all-done={progress[category]?.allDone}
          class:solo={categories.length === 1}
          use:reveal={currentCategory === category}
        >
          <button
            type="button"
            class="tab-pill"
            class:active={currentCategory === category}
            class:all-done={progress[category]?.allDone}
            title={category}
            onclick={() => onCategoryChange(category)}
          >
            {#if progress[category]?.allDone}<span class="tick" aria-hidden="true">✓</span>{/if}
            <span class="name">{category}</span>
            {#if progress[category] && progress[category].total > 0 && !progress[category].allDone}
              <span class="frac">{progress[category].done}/{progress[category].total}</span>
            {/if}
            {#if progress[category]?.allDone}<span class="sr-only"> — all steps done</span>{/if}
          </button>
          {#if categories.length > 1}
            <button type="button" class="remove" onclick={() => remove(category)} aria-label="Remove {category}">×</button>
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
  /* A window of fixed height, like the landing page's tag list (.tag-chips): about two rows of chips, more scroll inside it,
     the scroll stays in the box, and it never paints over what is around it. */
  .tab-row {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: var(--space-2);
    max-height: var(--tag-strip-height, 80px);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    position: relative;
    z-index: 0;
    isolation: isolate;
  }
  .tab-pill-wrap {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    max-width: 100%;
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 2px var(--space-1) 2px 0;
  }
  .tab-pill-wrap.solo {
    padding-right: var(--space-3);
  }
  .tab-pill-wrap.all-done {
    border-color: var(--accent);
  }
  .tab-pill-wrap.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .tab-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 9.5em; /* two chips per row on a phone; the full name is the heading below the strip */
    font-size: 13px;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    background: none;
    border: none;
    color: var(--text-lo);
    cursor: pointer;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-pill-wrap.active .tab-pill,
  .tab-pill-wrap.active .remove {
    color: var(--bg);
  }
  .tick {
    flex: none;
    font-weight: 700;
    color: var(--accent);
  }
  .tab-pill-wrap.active .tick {
    color: var(--bg);
  }
  .frac {
    flex: none;
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
  .remove {
    flex: none;
    background: none;
    border: none;
    color: var(--text-hi);
    opacity: 0.6;
    font-size: 14px;
    line-height: 1;
    padding: 0 var(--space-2);
    cursor: pointer;
  }
  .empty {
    text-align: center;
    padding: var(--space-4) 0;
    font-size: 13px;
    color: var(--text-faint);
  }
</style>
