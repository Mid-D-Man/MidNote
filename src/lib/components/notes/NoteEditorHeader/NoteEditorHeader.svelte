<script lang="ts">
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import TagSelector from "$lib/components/shared/TagSelector/TagSelector.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { removeEntry, saveEntry } from "$lib/stores/entries.svelte";
  import { createNote } from "$lib/storage";
  import type { Note } from "$lib/types/entry";

  // Undo/redo moved to the bottom formatting toolbar — reversed from
  // "kept up not down" on direct request. Header now holds only what's
  // always visible (back, delete, save, export) plus a "..." that opens
  // the rest (share, duplicate) in a bottom sheet, matching the Notion
  // reference rather than the earlier right-side-drawer plan.
  let {
    note,
    availableTags,
    onTagsChange,
    onSave,
    onBack,
  }: {
    note: Note;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    onBack: () => void;
  } = $props();

  let isSaving = $state(false);
  let showDeleteConfirm = $state(false);
  let moreOpen = $state(false);

  async function handleSave() {
    isSaving = true;
    onSave();
    pushToast({ title: "Note saved", description: "Your note has been saved successfully." });
    setTimeout(() => (isSaving = false), 400);
  }

  function handleBack() {
    onSave();
    onBack();
  }

  function handleDelete() {
    removeEntry(note.id);
    pushToast({ title: "Note deleted", description: "Your note has been deleted.", variant: "destructive" });
    goto("/");
  }

  function handleDuplicate() {
    moreOpen = false;
    const copy = createNote();
    copy.title = `${note.title} (Copy)`;
    copy.content = note.content;
    copy.tags = [...note.tags];
    saveEntry(copy);
    goto(`/note/${copy.id}`);
    pushToast({ title: "Note duplicated", description: "Your note has been duplicated." });
  }

  // Export/share are still the paused work (real Tauri fs + multi-format
  // + native share sheet) — this is last turn's single-format download,
  // just relocated, not rebuilt yet.
  function handleDownload() {
    const blob = new Blob([`${note.title}\n\n${note.content}`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${note.title || "note"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    pushToast({ title: "Note downloaded", description: "Your note has been downloaded as a text file." });
  }

  function handleShare() {
    moreOpen = false;
    pushToast({ title: "Share note", description: "Share functionality coming soon." });
  }
</script>

<header class="editor-header">
  <div class="row">
    <Button variant="ghost" size="icon" onclick={handleBack}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
    </Button>

    <div class="actions">
      <Button variant="ghost" size="icon" onclick={() => (showDeleteConfirm = true)} aria-label="Delete">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </Button>

      <Button variant="ghost" size="icon" onclick={handleSave} disabled={isSaving} aria-label="Save">
        {#if isSaving}
          <Spinner />
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
        {/if}
      </Button>

      <Button variant="ghost" size="icon" onclick={handleDownload} aria-label="Export">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
        </svg>
      </Button>

      <Button variant="ghost" size="icon" onclick={() => (moreOpen = true)} aria-label="More">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </Button>
    </div>
  </div>

  <TagSelector
    selectedTags={note.tags}
    {availableTags}
    onAddTag={(t) => onTagsChange([...note.tags, t])}
    onRemoveTag={(t) => onTagsChange(note.tags.filter((x) => x !== t))}
  />
</header>

<Sheet bind:open={moreOpen} side="bottom" title="Actions">
  <div class="action-list">
    <button class="action-row" onclick={handleShare}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
      </svg>
      <span>Share</span>
    </button>
    <button class="action-row" onclick={handleDuplicate}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span>Duplicate</span>
    </button>
  </div>
</Sheet>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete note"
  description="Are you sure you want to delete this note? This can't be undone."
  confirmLabel="Delete"
  danger
  onconfirm={handleDelete}
/>

<style>
  .editor-header {
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .action-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .action-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    text-align: left;
    padding: var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 14px;
    cursor: pointer;
  }
  .action-row:hover {
    background: var(--surface-raised);
  }
</style>
