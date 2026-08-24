<script lang="ts">
  import Card from "$lib/components/ui/Card/Card.svelte";
  import { stripHtml } from "$lib/utils/richText";
  import type { Note } from "$lib/types/entry";

  let {
    note,
    onToggleBookmark,
    onClick,
  }: {
    note: Note;
    onToggleBookmark: (id: string) => void;
    onClick: (id: string) => void;
  } = $props();

  // note.content is HTML now (see NoteContent.svelte) — strip tags for
  // the plain-text card preview rather than showing raw markup.
  const preview = $derived(stripHtml(note.content).slice(0, 120));
  const dateLabel = $derived(new Date(note.lastModified).toLocaleDateString());
</script>

<Card class="note-card" onclick={() => onClick(note.id)}>
  <button
    class="bookmark"
    class:active={note.isBookmarked}
    onclick={(e) => {
      e.stopPropagation();
      onToggleBookmark(note.id);
    }}
    aria-label="Toggle bookmark"
  >
    <svg viewBox="0 0 24 24" width="16" height="16" fill={note.isBookmarked ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
      <polygon points="12 2 15.09 8.63 22 9.24 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.24 8.91 8.63 12 2" />
    </svg>
  </button>

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
