<script lang="ts">
  import Card from "$lib/components/ui/Card/Card.svelte";
  import { stripHtml } from "$lib/utils/richText";
  import { createLongPressHandlers } from "$lib/utils/longPress";
  import type { Note } from "$lib/types/entry";

  let {
    note,
    onToggleBookmark,
    onClick,
    selectionMode = false,
    selected = false,
    onToggleSelect,
    onEnterSelectMode,
  }: {
    note: Note;
    onToggleBookmark: (id: string) => void;
    onClick: (id: string) => void;
    // Long-press-to-select — see the landing page for the actual
    // selection state; this component only reports gestures upward.
    selectionMode?: boolean;
    selected?: boolean;
    onToggleSelect?: (id: string) => void;
    onEnterSelectMode?: (id: string) => void;
  } = $props();

  // note.content is HTML now (see NoteContent.svelte) — strip tags for
  // the plain-text card preview rather than showing raw markup.
  const preview = $derived(stripHtml(note.content).slice(0, 120));
  const dateLabel = $derived(new Date(note.lastModified).toLocaleDateString());

  // Pointer-driven taps fire this (via onpointerup) before the browser's
  // own native `click` event has a chance to. suppressClick consumes
  // that immediately-following click so a single physical tap can't
  // double-fire both paths — see handleClick below. Keyboard-triggered
  // activation (Enter on a focused card) never goes through pointer
  // events at all, so it reaches handleClick with the flag still false
  // and works normally; this is what actually calls onclick.
  let suppressClick = false;

  function handleTap() {
    suppressClick = true;
    if (selectionMode) onToggleSelect?.(note.id);
    else onClick(note.id);
  }

  function handleLongPress() {
    suppressClick = true;
    onEnterSelectMode?.(note.id);
  }

  function handleClick() {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (selectionMode) onToggleSelect?.(note.id);
    else onClick(note.id);
  }

  const pressHandlers = createLongPressHandlers({
    onLongPress: handleLongPress,
    onTap: handleTap,
  });
</script>

<Card class="note-card {selected ? 'selected' : ''}" onclick={handleClick} {...pressHandlers}>
  {#if selectionMode}
    <div class="select-check" class:checked={selected} aria-hidden="true">
      {#if selected}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      {/if}
    </div>
  {:else}
    <button
      class="bookmark"
      class:active={note.isBookmarked}
      onclick={(e) => {
        e.stopPropagation();
        onToggleBookmark(note.id);
      }}
      onpointerdown={(e) => e.stopPropagation()}
      aria-label="Toggle bookmark"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill={note.isBookmarked ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.63 22 9.24 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.24 8.91 8.63 12 2" />
      </svg>
    </button>
  {/if}

  <h3 class="title">{note.title || "Untitled"}</h3>
  <p class="preview">{preview}</p>
  <p class="date">{dateLabel}</p>

  {#if note.tags.length > 0}
    <div class="tags">
      {#each note.tags as tag (tag)}
        <span class="tag">{tag}</span>
      {/each}
    </div>
  {/if}
</Card>

<style>
  :global(.note-card) {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
  }
  :global(.note-card.selected) {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .bookmark {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    cursor: pointer;
  }
  .bookmark:hover {
    background: var(--surface-raised);
  }
  .bookmark.active {
    color: var(--accent-2);
  }
  .select-check {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg);
  }
  .select-check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .title {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
    margin: 0 var(--space-6) var(--space-2) 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview {
    font-size: 13px;
    color: var(--text-lo);
    margin: 0 0 var(--space-3);
    min-height: 2.6em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .date {
    font-size: 11px;
    color: var(--text-faint);
    margin: 0 0 var(--space-2);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .tag {
    font-size: 11px;
    padding: 2px var(--space-2);
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 500;
  }
</style>
