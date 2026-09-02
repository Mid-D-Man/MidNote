<script lang="ts">
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import TagSelector from "$lib/components/shared/TagSelector/TagSelector.svelte";
  import FormatValuePicker from "$lib/components/notes/FormatValuePicker/FormatValuePicker.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { removeEntry, saveEntry } from "$lib/stores/entries.svelte";
  import { createNote } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { htmlToPlainText } from "$lib/utils/richText";
  import { shareFiles } from "$lib/utils/share";
  import type { Note } from "$lib/types/entry";

  // Undo/redo moved to the bottom formatting toolbar — reversed from
  // "kept up not down" on direct request. Header now holds only what's
  // always visible (back, delete, save, export) plus a "..." that opens
  // the rest (share, duplicate) in a bottom sheet, matching the Notion
  // reference rather than the earlier right-side-drawer plan.
  //
  // REVISION: this same "..." sheet is now ALSO where bold/italic/
  // underline/strikethrough/size/color/background live for the
  // no-selection ("plain typing") case — direct request, moving them
  // off the always-visible bottom row and into this existing popup
  // rather than the bottom toolbar showing every control all the time.
  // Only shown here when !hasSelection: when there IS a selection, the
  // bottom FormattingToolbar already shows B/I/U/S directly (the more
  // useful place for them when you've just selected something), so
  // repeating them here would be redundant. No captured-range handling
  // needed for the plain-typing case specifically — these calls set a
  // *pending* format for whatever gets typed next rather than touching
  // the live DOM Selection at all (see PendingFormats in richText.ts),
  // so there's no live selection here for a background tap to disturb
  // in the first place.
  let {
    note,
    availableTags,
    onTagsChange,
    onSave,
    onBack,
    hasSelection = false,
    activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, color: null, backgroundColor: null },
    onFormat,
    fontSize = 15,
    onFontSizeChange,
    onColorChange,
    onBackgroundColorChange,
  }: {
    note: Note;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    onBack: () => void;
    hasSelection?: boolean;
    activeFormats?: {
      bold: boolean;
      italic: boolean;
      underline: boolean;
      strikethrough: boolean;
      color: string | null;
      backgroundColor: string | null;
    };
    onFormat?: (format: string) => void;
    fontSize?: number;
    onFontSizeChange?: (size: number) => void;
    onColorChange?: (color: string | null) => void;
    onBackgroundColorChange?: (color: string | null) => void;
  } = $props();

  function tapFormat(format: string) {
    breadcrumb(`note header: ${format} tapped`);
    onFormat?.(format);
  }

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
    // note.content is HTML now (see NoteContent.svelte) — convert back
    // to plain text for export, or this would produce raw markup
    // instead of readable text.
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
  {#if !hasSelection}
    <div class="format-section">
      <span class="group-label">Formatting</span>
      <div class="inline-format-row">
        <button type="button" class:active={activeFormats.bold} onclick={() => tapFormat("bold")} aria-label="Bold"><strong>B</strong></button>
        <button type="button" class:active={activeFormats.italic} onclick={() => tapFormat("italic")} aria-label="Italic"><em>I</em></button>
        <button type="button" class:active={activeFormats.underline} onclick={() => tapFormat("underline")} aria-label="Underline"><span class="underline">U</span></button>
        <button type="button" class:active={activeFormats.strikethrough} onclick={() => tapFormat("strikethrough")} aria-label="Strikethrough"><span class="strike">S</span></button>
      </div>
      <FormatValuePicker
        {fontSize}
        onFontSizeChange={(size) => onFontSizeChange?.(size)}
        color={activeFormats.color}
        onColorChange={(c) => onColorChange?.(c)}
        backgroundColor={activeFormats.backgroundColor}
        onBackgroundColorChange={(c) => onBackgroundColorChange?.(c)}
      />
    </div>
    <div class="section-divider"></div>
  {/if}
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
  .format-section {
    margin-bottom: var(--space-4);
  }
  .group-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--space-2);
  }
  .inline-format-row {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .inline-format-row button {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
    font-size: 15px;
  }
  .inline-format-row button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .underline {
    text-decoration: underline;
  }
  .strike {
    text-decoration: line-through;
  }
  .section-divider {
    height: 1px;
    background: var(--hairline);
    margin: var(--space-4) 0;
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
