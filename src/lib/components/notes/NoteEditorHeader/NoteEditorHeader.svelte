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
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { htmlToPlainText } from "$lib/utils/richText";
  import { shareFiles } from "$lib/utils/share";
  import type { Note } from "$lib/types/entry";

  // REVISION: back to just Share/Duplicate in the "..." sheet — B/I/U/S/
  // size/color/background moved back to the bottom FormattingToolbar,
  // direct request, pointing at FlyNote's own editor as the reference
  // (one persistent toolbar with small anchored popups, not a
  // full-screen sheet). See FormattingToolbar.svelte for where that
  // logic lives now, and NoteContent.svelte for why it no longer needs
  // any of the capturedFormatRange/formatPickerOpen machinery this
  // header used to coordinate with the page over.
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
    breadcrumb("note header: Save tapped");
    isSaving = true;
    onSave();
    pushToast({ title: "Note saved", description: "Your note has been saved successfully." });
    setTimeout(() => (isSaving = false), 400);
  }

  function handleBack() {
    breadcrumb("note header: Back tapped");
    onSave();
    onBack();
  }

  function handleDelete() {
    breadcrumb("note header: Delete tapped");
    removeEntry(note.id);
    pushToast({ title: "Note deleted", description: "Your note has been deleted.", variant: "destructive" });
    goto("/");
  }

  function handleDuplicate() {
    breadcrumb("note header: Duplicate tapped");
    moreOpen = false;
    const copy = createNote();
    copy.title = `${note.title} (Copy)`;
    copy.content = note.content;
    copy.tags = [...note.tags];
    saveEntry(copy);
    goto(`/note/${copy.id}`);
    pushToast({ title: "Note duplicated", description: "Your note has been duplicated." });
  }

  // Export/share: Export downloads a .txt of this note; Share hands the
  // exact same file to navigator.share (see share.ts's header comment
  // for the real, stated platform uncertainty around file-sharing
  // support on this specific WebView — feature-detected with a
  // text-only fallback, not assumed to just work).
  function buildExportBlob(): Blob {
    // note.content is HTML — convert back to plain text for export, or
    // this would produce raw markup instead of readable text.
    return new Blob([`${note.title}\n\n${htmlToPlainText(note.content)}`], { type: "text/plain" });
  }

  function handleDownload() {
    breadcrumb("note header: Export tapped");
    const blob = buildExportBlob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${note.title || "note"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    pushToast({ title: "Note downloaded", description: "Your note has been downloaded as a text file." });
  }

  async function handleShare() {
    breadcrumb("note header: Share tapped");
    moreOpen = false;
    const name = `${note.title || "note"}.txt`;
    const result = await shareFiles([{ name, blob: buildExportBlob() }], { title: note.title || "Note" });
    if (result === "shared") {
      pushToast({ title: "Shared" });
    } else if (result !== "cancelled") {
      pushToast({ title: "Sharing isn't available here", description: "Try Export instead." });
    }
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
      <Button variant="ghost" size="icon" onclick={() => { breadcrumb("note header: Delete icon tapped (confirm dialog opening)"); showDeleteConfirm = true; }} aria-label="Delete">
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

      <Button variant="ghost" size="icon" onclick={() => { breadcrumb("note header: More (...) tapped"); moreOpen = true; }} aria-label="More">
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
