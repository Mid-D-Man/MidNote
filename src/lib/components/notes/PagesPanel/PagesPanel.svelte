<script lang="ts">
  // Reachable from NoteEditorHeader's Actions sheet ("Pages" row) — see
  // that file for the sequential-sheet-swap wiring (close Actions, open
  // this). Page 1 is always note.content itself (see entry.ts's
  // Note.pages comment). The page you're CURRENTLY viewing is the one
  // that can't be deleted — not page 1 specifically — since a note
  // always needs at least one page and deleting the one you're looking
  // at out from under yourself is the confusing case; page 1 is
  // deletable like any other page once you've switched off it (see the
  // route's deletePage, which promotes the next page into its place).
  // Pages default to auto-numbered ("Page 1", "Page 2", ...) but can be
  // renamed via the pencil icon on each row (page 1 included, through
  // note.page1Name) — leaving the rename field blank reverts to the
  // auto-numbered name.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { Note } from "$lib/types/entry";

  let {
    open = $bindable(false),
    note,
    currentPageIndex,
    onSwitchPage,
    onAddPage,
    onDeletePage,
    onRenamePage,
  }: {
    open?: boolean;
    note: Note;
    // 0 = note.content ("Page 1"), 1+ = note.pages[index - 1].
    currentPageIndex: number;
    onSwitchPage: (index: number) => void;
    onAddPage: () => void;
    onDeletePage: (index: number) => void;
    // index 0 renames note.page1Name; 1+ renames note.pages[index-1].name.
    // Pass null (or a blank/whitespace-only string) to revert to the
    // auto-numbered "Page N" name.
    onRenamePage: (index: number, name: string | null) => void;
  } = $props();

  const totalPages = $derived(1 + note.pages.length);

  function pageName(i: number): string | null {
    return i === 0 ? note.page1Name : (note.pages[i - 1]?.name ?? null);
  }
  function displayName(i: number): string {
    return pageName(i) || `Page ${i + 1}`;
  }

  let confirmDeleteIndex = $state<number | null>(null);
  let renamingIndex = $state<number | null>(null);
  let renameValue = $state("");
  let renameInputEl = $state<HTMLInputElement | null>(null);

  function handleSwitch(index: number) {
    if (index === currentPageIndex) {
      open = false;
      return;
    }
    breadcrumb(`pages panel: switch to page ${index + 1}`);
    onSwitchPage(index);
    open = false;
  }

  function handleAdd() {
    breadcrumb("pages panel: add page tapped");
    onAddPage();
    open = false;
  }

  function requestDelete(e: Event, index: number) {
    e.stopPropagation();
    confirmDeleteIndex = index;
  }

  function confirmDelete() {
    if (confirmDeleteIndex === null) return;
    breadcrumb(`pages panel: delete page ${confirmDeleteIndex + 1} confirmed`);
    onDeletePage(confirmDeleteIndex);
    confirmDeleteIndex = null;
  }

  function startRename(e: Event, index: number) {
    e.stopPropagation();
    renamingIndex = index;
    renameValue = pageName(index) ?? "";
    // The input doesn't exist yet on this same tick (renamingIndex just
    // flipped the {#if} on) — queue the focus for right after it mounts.
    queueMicrotask(() => renameInputEl?.focus());
  }

  function commitRename() {
    if (renamingIndex === null) return;
    breadcrumb(`pages panel: rename page ${renamingIndex + 1}`);
    const trimmed = renameValue.trim();
    onRenamePage(renamingIndex, trimmed.length > 0 ? trimmed : null);
    renamingIndex = null;
  }

  function cancelRename(e?: Event) {
    e?.stopPropagation();
    renamingIndex = null;
  }
</script>

<Sheet bind:open side="bottom" title="Pages">
  <div class="pages-list">
    {#each Array.from({ length: totalPages }) as _, i (i)}
      <div
        class="page-row"
        class:active={i === currentPageIndex}
        role="button"
        tabindex="0"
        onclick={() => handleSwitch(i)}
        onkeydown={(e) => e.key === "Enter" && handleSwitch(i)}
      >
        {#if renamingIndex === i}
          <input
            bind:this={renameInputEl}
            class="rename-input"
            type="text"
            bind:value={renameValue}
            placeholder="Page {i + 1}"
            maxlength="60"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") cancelRename(e);
            }}
            onblur={commitRename}
          />
        {:else}
          <span class="page-name">{displayName(i)}</span>
        {/if}
        {#if i === currentPageIndex && renamingIndex !== i}
          <span class="current-badge">Current</span>
        {/if}
        {#if renamingIndex !== i}
          <button type="button" class="icon-btn" aria-label="Rename {displayName(i)}" onclick={(e) => startRename(e, i)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        {/if}
        {#if i !== currentPageIndex && renamingIndex !== i}
          <button type="button" class="icon-btn delete-btn" aria-label="Delete {displayName(i)}" onclick={(e) => requestDelete(e, i)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
            </svg>
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <button type="button" class="add-page-btn" onclick={handleAdd}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
    Add Page
  </button>
</Sheet>

<ConfirmDialog
  open={confirmDeleteIndex !== null}
  title="Delete {confirmDeleteIndex !== null ? displayName(confirmDeleteIndex) : ''}?"
  description="Its content will be gone for good — this can't be undone."
  confirmLabel="Delete"
  danger
  onconfirm={confirmDelete}
  oncancel={() => (confirmDeleteIndex = null)}
/>

<style>
  .pages-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .page-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
  }
  .page-row.active {
    border-color: var(--accent);
  }
  .page-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    color: var(--text-hi);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename-input {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }
  .current-badge {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
    flex-shrink: 0;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    cursor: pointer;
    flex-shrink: 0;
  }
  .icon-btn:hover {
    background: var(--surface);
    color: var(--text-hi);
  }
  .delete-btn:hover {
    color: var(--danger);
  }
  .add-page-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3);
    background: transparent;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .add-page-btn:hover {
    background: var(--surface-raised);
  }
</style>
