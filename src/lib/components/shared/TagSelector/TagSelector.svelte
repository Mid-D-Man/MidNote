<script lang="ts">
  let {
    selectedTags,
    availableTags,
    onAddTag,
    onRemoveTag,
  }: {
    selectedTags: string[];
    availableTags: string[];
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
  } = $props();

  let isOpen = $state(false);
  let searchInput = $state("");

  const filteredTags = $derived(
    availableTags
      .filter((t) => !selectedTags.includes(t))
      .filter((t) => t.toLowerCase().includes(searchInput.toLowerCase()))
  );

  function pick(tag: string) {
    onAddTag(tag);
    isOpen = false;
    searchInput = "";
  }

  // BUGFIX — same bug class as Sheet.svelte/LockPrompt.svelte (see
  // Sheet's comment for the full mechanism): this dropdown has its own
  // separate position:fixed;inset:0 scrim, missed when fixing those two
  // since this is a bespoke implementation, not built on Sheet. Same
  // fix: ignore the scrim's dismiss-click for a brief window right
  // after opening, so the same tap that opened "Add Tag" can't also
  // have its trailing click land on the scrim and instantly close it.
  let scrimGuardActive = $state(false);
  $effect(() => {
    if (!isOpen) return;
    scrimGuardActive = true;
    const timer = setTimeout(() => {
      scrimGuardActive = false;
    }, 300);
    return () => clearTimeout(timer);
  });

  function handleScrimClick() {
    if (scrimGuardActive) return;
    isOpen = false;
  }
</script>

<div class="tag-selector">
  {#each selectedTags as tag (tag)}
    <div class="selected-tag">
      {tag}
      <button onclick={() => onRemoveTag(tag)} aria-label="Remove {tag}">×</button>
    </div>
  {/each}

  <div class="add-wrap">
    <button class="add-btn" onclick={() => (isOpen = !isOpen)}>
      Add Tag <span class="chevron">⌄</span>
    </button>

    {#if isOpen}
      <div class="scrim" onclick={handleScrimClick} role="presentation"></div>
      <div class="dropdown">
        <input type="text" placeholder="Search tags..." bind:value={searchInput} />
        <div class="list">
          {#if filteredTags.length > 0}
            {#each filteredTags as tag (tag)}
              <button class="option" onclick={() => pick(tag)}>{tag}</button>
            {/each}
          {:else}
            <div class="empty">No tags available</div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .tag-selector {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .selected-tag {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 4px var(--space-2);
    /* Falls back to the original fixed values when no themed ancestor
       sets --theme-tag-bg/--theme-text-hi (the normal case everywhere
       this component is used) — see NoteEditorHeader.svelte/
       TodoHeader.svelte's has-image-theme block for the one place that
       does set them. Native CSS custom-property fallback, not
       color-mix() — safe for this app's target Android WebView. */
    background: var(--theme-tag-bg, var(--accent-wash));
    color: var(--theme-tag-text, var(--accent));
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  }
  .selected-tag button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }
  .add-wrap {
    position: relative;
  }
  .add-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 4px var(--space-3);
    /* BUGFIX: was unconditionally transparent — genuinely illegible
       against a busy or light header image (the same class of issue as
       the landing page's "Add Tag" button, flagged from a screenshot).
       Same fallback approach as .selected-tag above. */
    background: var(--theme-tag-bg, transparent);
    border: 1px solid var(--theme-text-lo, var(--hairline));
    border-radius: 999px;
    color: var(--theme-text-hi, var(--text-hi));
    cursor: pointer;
  }
  .chevron {
    font-size: 10px;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    z-index: 50;
    min-width: 160px;
  }
  .dropdown input {
    width: 100%;
    font-size: 12px;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--hairline);
    color: var(--text-hi);
  }
  .dropdown input:focus {
    outline: none;
  }
  .list {
    max-height: 160px;
    overflow-y: auto;
  }
  .option {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
    background: none;
    border: none;
    color: var(--text-hi);
    cursor: pointer;
  }
  .option:hover {
    background: var(--accent-wash);
  }
  .empty {
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
