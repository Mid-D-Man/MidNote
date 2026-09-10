<script lang="ts">
  import Card from "$lib/components/ui/Card/Card.svelte";
  import CardOverflowMenu from "$lib/components/shared/CardOverflowMenu/CardOverflowMenu.svelte";
  import TagsPopup from "$lib/components/shared/TagsPopup/TagsPopup.svelte";
  import { lockEntry, unlockEntry } from "$lib/utils/lockFlow";
  import { noteTags, registerTag, unregisterTag } from "$lib/stores/tags.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { stripHtml } from "$lib/utils/richText";
  import { createLongPressHandlers } from "$lib/utils/longPress";
  import { resolveTheme, hexToRgba, getIconGlyph } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import type { Note } from "$lib/types/entry";

  let {
    note,
    onToggleBookmark,
    onClick,
    selectionMode = false,
    selected = false,
    onToggleSelect,
    onEnterSelectMode,
    onDelete,
    onDownload,
    onToggleStrikethrough,
    onTogglePin,
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
    // ⋮ overflow menu actions — same callback-prop shape as
    // onToggleBookmark: NoteCard stays a dumb display component, the
    // page owns the actual store mutations.
    onDelete: (id: string) => void;
    onDownload: (id: string) => void;
    onToggleStrikethrough: (id: string) => void;
    onTogglePin: (id: string) => void;
  } = $props();

  // note.content is HTML now (see NoteContent.svelte) — strip tags for
  // the plain-text card preview rather than showing raw markup. Locked
  // notes have an empty content field (the real content lives inside
  // lockedPayload instead — see utils/lockFlow.ts), so show an explicit
  // placeholder rather than a blank card that looks broken.
  const preview = $derived(note.encrypted ? "🔒 Locked" : stripHtml(note.content).slice(0, 120));
  const dateLabel = $derived(new Date(note.lastModified).toLocaleDateString());

  const resolved = $derived(resolveTheme(note.headerTheme, customThemes));
  // Left-edge stripe + faint wash for a color theme; full cover image +
  // scrim for a custom upload. "none" leaves cardStyle empty so the card
  // keeps its ordinary --surface background untouched.
  const cardStyle = $derived(
    resolved.kind === "color"
      ? `border-left: 4px solid ${resolved.color}; background: ${hexToRgba(resolved.color, 0.08)};`
      : resolved.kind === "image"
        ? `background-image: url(${resolved.dataUrl}); background-size: cover; background-position: center;`
        : "",
  );
  const iconGlyph = $derived(getIconGlyph(note.icon));

  // Pointer-driven taps fire this (via onpointerup) before the browser's
  // own native `click` event has a chance to. suppressClick consumes
  // that immediately-following click so a single physical tap can't
  // double-fire both paths — see handleClick below. Keyboard-triggered
  // activation (Enter on a focused card) never goes through pointer
  // events at all, so it reaches handleClick with the flag still false
  // and works normally; this is what actually calls onclick.
  let suppressClick = false;
  // See handleToggleLock below — true only while THIS card's own
  // lock/unlock invoke() is actually in flight.
  let lockBusy = $state(false);

  function handleTap() {
    if (lockBusy) return;
    suppressClick = true;
    if (selectionMode) onToggleSelect?.(note.id);
    else onClick(note.id);
  }

  function handleLongPress() {
    if (lockBusy) return;
    suppressClick = true;
    onEnterSelectMode?.(note.id);
  }

  function handleClick() {
    if (lockBusy) return;
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

  async function handleToggleLock() {
    // Argon2id is deliberately slow — this is a real, perceptible wait
    // on real hardware, not a formality. lockBusy drives CardOverflowMenu's
    // trigger spinner (see that component's `busy` prop) and blocks card
    // taps below, so a mid-flight tap can't navigate into an entry whose
    // encrypted flag is about to flip out from under it.
    lockBusy = true;
    try {
      if (note.encrypted) await unlockEntry(note);
      else await lockEntry(note);
    } finally {
      lockBusy = false;
    }
  }

  let tagsOpen = $state(false);
  function handleAddTag(tag: string) {
    note.tags = [...note.tags, tag];
    registerTag("notes", tag);
    saveEntry(note);
  }
  function handleRemoveTag(tag: string) {
    note.tags = note.tags.filter((t) => t !== tag);
    saveEntry(note);
  }
</script>

<Card class="note-card {selected ? 'selected' : ''} {resolved.kind === 'image' ? 'has-image-theme' : ''}" style={cardStyle} onclick={handleClick} {...pressHandlers}>
  {#if resolved.kind === "image"}
    <div class="theme-scrim" aria-hidden="true"></div>
  {/if}
  {#if selectionMode}
    <div class="select-check" class:checked={selected} aria-hidden="true">
      {#if selected}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      {/if}
    </div>
  {:else}
    <div class="corner-actions">
      <CardOverflowMenu
        itemLabel="note"
        struck={note.struck}
        pinned={note.isPinned}
        encrypted={note.encrypted}
        busy={lockBusy}
        onDelete={() => onDelete(note.id)}
        onDownload={() => onDownload(note.id)}
        onToggleStrikethrough={() => onToggleStrikethrough(note.id)}
        onTogglePin={() => onTogglePin(note.id)}
        onToggleLock={handleToggleLock}
        onOpenTags={() => (tagsOpen = true)}
      />
      {#if note.isPinned}
        <span class="pin-indicator" aria-label="Pinned" title="Pinned">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M12 17v5" /><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
          </svg>
        </span>
      {/if}
    </div>
    <button
      class="bookmark"
      class:active={note.isBookmarked}
      onclick={(e) => {
        e.stopPropagation();
        onToggleBookmark(note.id);
      }}
      onpointerdown={(e) => e.stopPropagation()}
      onpointerup={(e) => e.stopPropagation()}
      onpointermove={(e) => e.stopPropagation()}
      onpointercancel={(e) => e.stopPropagation()}
      aria-label="Toggle bookmark"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill={note.isBookmarked ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.63 22 9.24 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.24 8.91 8.63 12 2" />
      </svg>
    </button>
  {/if}

  <div class="title-row">
    {#if iconGlyph}
      <span class="icon-badge" aria-hidden="true">{iconGlyph}</span>
    {/if}
    <h3 class="title" class:struck={note.struck}>{note.title || "Untitled"}</h3>
  </div>
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

<TagsPopup bind:open={tagsOpen} tags={note.tags} availableTags={noteTags} onAddTag={handleAddTag} onRemoveTag={handleRemoveTag} />

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
  .theme-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(4, 6, 16, 0.15) 0%, rgba(4, 6, 16, 0.72) 100%);
    border-radius: inherit;
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
  .corner-actions {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .pin-indicator {
    width: 16px;
    height: 16px;
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .title.struck {
    text-decoration: line-through;
    color: var(--text-lo);
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
  .title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    /* Left margin reserves room for corner-actions (overflow trigger +
       the pin indicator badge that sits next to it when pinned) so a
       long title never runs underneath either — space-6 alone (used on
       the right, under just the bookmark icon) isn't quite wide enough
       once the pin badge is showing too. Carried over unchanged from
       when this margin lived directly on .title, before the icon badge
       needed a row to sit in next to it. */
    margin: 0 var(--space-6) var(--space-2) 48px;
  }
  .icon-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface-raised);
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }
  .title {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
    min-width: 0;
    flex: 1;
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

  /* The scrim guarantees a dark backdrop regardless of the app's own
     light/dark mode setting, so text drawn over it needs to be forced
     light too — the ordinary --text-hi/--text-lo tokens flip to
     near-black in light mode and would be unreadable here otherwise. */
  :global(.note-card.has-image-theme) .title,
  :global(.note-card.has-image-theme) .preview,
  :global(.note-card.has-image-theme) .date {
    color: rgba(255, 255, 255, 0.95);
  }
  :global(.note-card.has-image-theme) .preview {
    color: rgba(255, 255, 255, 0.78);
  }
  :global(.note-card.has-image-theme) .date {
    color: rgba(255, 255, 255, 0.6);
  }
  :global(.note-card.has-image-theme) .tag {
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.92);
  }
</style>
