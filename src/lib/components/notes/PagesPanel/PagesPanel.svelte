<script lang="ts">
  // Reachable from NoteEditorHeader's Actions sheet ("Pages" row) — see
  // that file for the sequential-sheet-swap wiring (close Actions, open
  // this). Page 1 is always note.content itself (see entry.ts's
  // Note.pages comment) and can't be deleted — a note always has at
  // least one page by definition, so there's nothing to delete it INTO.
  // Pages are auto-numbered ("Page 1", "Page 2", ...) rather than
  // custom-titled — simplest reading of the actual request, easy to
  // extend to custom titles later without a data-shape change if
  // that's ever wanted (title would just be a new optional field on
  // NotePage).
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
  }: {
    open?: boolean;
    note: Note;
    // 0 = note.content ("Page 1"), 1+ = note.pages[index - 1].
    currentPageIndex: number;
    onSwitchPage: (index: number) => void;
    onAddPage: () => void;
    onDeletePage: (index: number) => void;
  } = $props();

  const totalPages = $derived(1 + note.pages.length);
  let confirmDeleteIndex = $state<number | null>(null);

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
        <span class="page-name">Page {i + 1}</span>
        {#if i === currentPageIndex}
          <span class="current-badge">Current</span>
        {/if}
        {#if i > 0}
          <button type="button" class="delete-btn" aria-label="Delete Page {i + 1}" onclick={(e) => requestDelete(e, i)}>
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
  title="Delete page {confirmDeleteIndex !== null ? confirmDeleteIndex + 1 : ''}?"
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
    font-size: 14px;
    color: var(--text-hi);
    font-weight: 500;
  }
  .current-badge {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
  }
  .delete-btn {
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
  .delete-btn:hover {
    background: var(--surface);
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
