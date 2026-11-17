<script lang="ts">
  import { scrollStrip } from "$lib/utils/scrollStrip";

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
  // Which side of the "Add Tag" button the list opens towards: the button sits at the right end of the row once the tags
  // overflow, and a list opening to its right would run off the screen (decided when it opens, from where the button is).
  let openRight = $state(false);
  let addBtn = $state<HTMLButtonElement | null>(null);
  const DROPDOWN_WIDTH = 200;
  function toggleList() {
    if (!isOpen && addBtn) openRight = addBtn.getBoundingClientRect().left + DROPDOWN_WIDTH > window.innerWidth - 8;
    isOpen = !isOpen;
  }

  // The tags are ONE row that scrolls sideways (a swipe on the phone, a drag with a mouse) instead of wrapping onto more and
  // more lines: the header stays the same height however many tags there are. Fades at an edge show there is more that way.
  // The scrolling itself is utils/scrollStrip.ts.
  let canLeft = $state(false);
  let canRight = $state(false);
  const showEdges = (left: boolean, right: boolean) => {
    canLeft = left;
    canRight = right;
  };

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
  <div class="strip" class:can-left={canLeft} class:can-right={canRight} role="list" aria-label="Tags" use:scrollStrip={showEdges}>
    {#each selectedTags as tag (tag)}
      <div class="selected-tag" role="listitem">
        <span class="tag-name">{tag}</span>
        <button onclick={() => onRemoveTag(tag)} aria-label="Remove {tag}">×</button>
      </div>
    {/each}
  </div>

  <div class="add-wrap">
    <button class="add-btn" bind:this={addBtn} onclick={toggleList}>
      Add Tag <span class="chevron">⌄</span>
    </button>

    {#if isOpen}
      <div class="scrim" onclick={handleScrimClick} role="presentation"></div>
      <div class="dropdown" class:open-right={openRight}>
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
    flex-wrap: nowrap;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    max-width: 100%;
  }
  /* One row, never wrapping: it takes only the room the tags need and, once they need more than there is, shrinks to the
     space left of the Add Tag button and scrolls sideways inside itself. */
  .strip {
    --fade-left: 0px;
    --fade-right: 0px;
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .strip.can-left {
    --fade-left: 18px;
  }
  .strip.can-right {
    --fade-right: 18px;
  }
  .selected-tag {
    flex: none;
    white-space: nowrap;
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
  .tag-name {
    max-width: 16em;
    overflow: hidden;
    text-overflow: ellipsis;
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
    flex: none;
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
  .dropdown.open-right {
    left: auto;
    right: 0;
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
