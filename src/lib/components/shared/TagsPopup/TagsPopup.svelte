<script lang="ts">
  // The Tags popup opened from a card's ⋮ menu on the landing pages (Notes, Todos, Boards).
  //
  // It used to host the editor headers' little "Add Tag" dropdown inside the sheet: the dropdown (12px text, rows only
  // ~25px tall, its own 160px scroller) hung off the bottom of a sheet that was only as tall as one row of chips, so the
  // sheet itself had to be scrolled to reach even the second tag. Here the list is simply part of the sheet:
  //
  //   On this item   the item's tags as chips with a clear × (a 36px target)
  //   Search box     filters as you type; with a name that isn't there yet it offers "Create <name>"
  //   The list       one full-width row per tag (48px tall, 15px text), in a box that is tall enough to see several
  //                  at once and scrolls inside itself when there are more
  //
  // A tap adds the tag and the popup STAYS open so several can be added in a row (swipe it down or tap outside to
  // close). Same props as before, so the callers (NoteCard, the landing page's todo and board rows) are unchanged.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { MAX_TAG_LENGTH, cleanTagName, creatableName, visibleTags } from "$lib/utils/tagNames";

  let {
    open = $bindable(false),
    tags,
    availableTags,
    onAddTag,
    onRemoveTag,
  }: {
    open?: boolean;
    tags: string[];
    availableTags: string[];
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
  } = $props();

  let query = $state("");

  const matches = $derived(visibleTags(availableTags, tags, query));
  const creatable = $derived(creatableName(query, availableTags, tags));
  const typed = $derived(query.trim().length > 0);
  const tooLong = $derived(typed && cleanTagName(query) === "" && query.trim().length > MAX_TAG_LENGTH);

  function add(tag: string) {
    onAddTag(tag);
    query = "";
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (creatable) add(creatable);
    else if (matches.length === 1) add(matches[0]);
  }

  // A fresh search each time the popup opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) query = "";
    wasOpen = open;
  });
</script>

<Sheet bind:open side="bottom" title="Tags" lift>
  <div class="popup">
    {#if tags.length > 0}
      <div class="group">
        <span class="label">On this item</span>
        <div class="chips">
          {#each tags as tag (tag)}
            <span class="chip">
              <span class="chip-name">{tag}</span>
              <button type="button" class="chip-x" aria-label={`Remove ${tag} from this item`} onclick={() => onRemoveTag(tag)}>×</button>
            </span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="group">
      <label class="label" for="tags-popup-search">Add a tag</label>
      <input
        id="tags-popup-search"
        type="text"
        class="search"
        placeholder="Search or type a new tag"
        aria-label="Search or type a new tag"
        autocomplete="off"
        autocapitalize="sentences"
        enterkeyhint="done"
        bind:value={query}
        onkeydown={onKeydown}
      />
    </div>

    <div class="list" role="group" aria-label="Tags you can add">
      {#if creatable}
        <button type="button" class="row create" aria-label={`Create tag ${creatable}`} onclick={() => add(creatable)}>
          <span class="plus" aria-hidden="true">+</span>
          <span class="row-name">Create “{creatable}”</span>
        </button>
      {/if}
      {#each matches as tag (tag)}
        <button type="button" class="row" aria-label={`Add tag ${tag}`} onclick={() => add(tag)}>
          <span class="row-name">{tag}</span>
        </button>
      {/each}
      {#if matches.length === 0 && !creatable}
        <p class="empty">
          {#if tooLong}
            Tag names can be up to {MAX_TAG_LENGTH} characters.
          {:else if typed}
            Nothing matches “{query.trim()}”.
          {:else if availableTags.length === 0}
            No tags yet. Type a name above to make one.
          {:else}
            This item already has every tag. Type a name above to make a new one.
          {/if}
        </p>
      {/if}
    </div>
  </div>
</Sheet>

<style>
  .popup {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    background: var(--accent-wash);
    color: var(--accent);
    border-radius: 999px;
    font-size: 14px;
    font-weight: 500;
  }
  .chip-name {
    padding: 6px 0 6px var(--space-3);
    overflow-wrap: anywhere;
  }
  .chip-x {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .search {
    min-height: 48px;
    padding: 0 var(--space-3);
    font-size: 16px; /* 16px stops phones zooming the page when the field is focused */
    font-family: inherit;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .search:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  /* Tall enough for about five rows; more scroll in here, not in the sheet. */
  .list {
    display: flex;
    flex-direction: column;
    max-height: min(280px, 38dvh);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
    width: 100%;
    min-height: 48px;
    padding: 0 var(--space-4);
    text-align: left;
    font-size: 15px;
    font-family: inherit;
    color: var(--text-hi);
    background: none;
    border: none;
    border-bottom: 1px solid var(--hairline);
    cursor: pointer;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row:active {
    background: var(--accent-wash);
  }
  .row-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row.create {
    color: var(--accent);
    font-weight: 500;
  }
  .plus {
    font-size: 20px;
    line-height: 1;
  }
  .empty {
    margin: 0;
    padding: var(--space-4);
    font-size: 14px;
    color: var(--text-faint);
  }
</style>
