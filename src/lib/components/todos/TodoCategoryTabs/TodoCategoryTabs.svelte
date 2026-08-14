<script lang="ts">
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";

  let {
    categories,
    currentCategory,
    onCategoryChange,
    onAddCategory,
    onRemoveCategory,
  }: {
    categories: string[];
    currentCategory: string;
    onCategoryChange: (category: string) => void;
    onAddCategory: (category: string) => void;
    onRemoveCategory: (category: string) => void;
  } = $props();

  let isAdding = $state(false);
  let newCategory = $state("");

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

  function remove(category: string) {
    onRemoveCategory(category);
    if (currentCategory === category && categories.length > 1) {
      onCategoryChange(categories[0] === category ? categories[1] : categories[0]);
    }
  }
</script>

<div class="tabs-wrap">
  <div class="header">
    <span class="label">Sub-categories</span>
    <Button size="sm" variant="outline" onclick={() => (isAdding = !isAdding)}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Add
    </Button>
  </div>

  {#if isAdding}
    <div class="add-row">
      <Input bind:value={newCategory} placeholder="Category name..." onkeydown={keydown} />
      <Button size="sm" onclick={commitAdd}>Save</Button>
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
            onclick={() => onCategoryChange(category)}
          >
            {category}
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
