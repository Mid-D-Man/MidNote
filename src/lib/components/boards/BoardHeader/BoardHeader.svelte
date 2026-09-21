<!--
  Board's editor header. Deliberately kept as close to NoteEditorHeader's
  shape as possible — same icon row, same "..." Actions sheet, same
  TagSelector/ThemeSectionsSheet/ConfirmDialog trio — rather than
  inventing a fourth slightly-different header pattern. The one
  structural difference: no Pages row, since a board has no page
  concept; nodes/edges are its content instead.
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import TagSelector from "$lib/components/shared/TagSelector/TagSelector.svelte";
  import ThemeSectionsSheet from "$lib/components/shared/ThemeSectionsSheet/ThemeSectionsSheet.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { removeEntry, saveEntry } from "$lib/stores/entries.svelte";
  import { createBoard } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { shareFiles } from "$lib/utils/share";
  import { entryToPlainText, buildExportFiles, buildEncryptedBackupFile, downloadFiles } from "$lib/utils/selectionActions";
  import { resolveTheme, hexToRgba, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import type { Board, IconRef, ThemeRef } from "$lib/types/entry";

  let {
    board,
    availableTags,
    onTagsChange,
    onSave,
    onBack,
  }: {
    board: Board;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    onBack: () => void;
  } = $props();

  let isSaving = $state(false);
  let showDeleteConfirm = $state(false);
  let moreOpen = $state(false);
  let themeSheetOpen = $state(false);

  const resolvedHeaderTheme = $derived(resolveTheme(board.headerTheme, customThemes));
  const headerStyle = $derived(
    resolvedHeaderTheme.kind === "color"
      ? `background: ${hexToRgba(resolvedHeaderTheme.color, 0.14)}; border-bottom-color: ${resolvedHeaderTheme.color};`
      : resolvedHeaderTheme.kind === "image"
        ? // Same fix as NoteEditorHeader.svelte's identical headerStyle —
          // see that file's comment for the full reasoning.
          `background-image: linear-gradient(rgba(4,6,16,0.35), rgba(4,6,16,0.35)), url(${resolvedHeaderTheme.dataUrl}); background-size: cover; background-position: center; ${getImageTextColorVars(resolvedHeaderTheme.textColor)}`
        : "",
  );

  // Same data-safety gating as NoteEditorHeader/TodoHeader's identical
  // functions — this header renders unconditionally even while
  // board.encrypted (only the canvas swaps for the locked placeholder,
  // see board/[id]/+page.svelte), so Theme/Duplicate/Share need the
  // same refuse-with-a-toast gate Delete already has, operating on
  // already-cleared nodes/edges otherwise (lockFlow.ts's
  // clearPlaintextFields).
  function handleOpenThemeSheet() {
    breadcrumb(`board header: Theme tapped (encrypted=${board.encrypted})`);
    if (board.encrypted) {
      moreOpen = false;
      pushToast({ title: "Unlock first", description: "Unlock this board before changing its theme.", variant: "destructive" });
      return;
    }
    moreOpen = false;
    themeSheetOpen = true;
  }

  function handleHeaderThemeChange(theme: ThemeRef) {
    board.headerTheme = theme;
    saveEntry(board);
  }
  function handleBodyThemeChange(theme: ThemeRef) {
    board.bodyTheme = theme;
    saveEntry(board);
  }
  function handleIconChange(icon: IconRef | null) {
    board.icon = icon;
    saveEntry(board);
  }

  async function handleSave() {
    breadcrumb("board header: Save tapped");
    isSaving = true;
    onSave();
    pushToast({ title: "Board saved", description: "Your board has been saved successfully." });
    setTimeout(() => (isSaving = false), 400);
  }

  function handleBack() {
    breadcrumb("board header: Back tapped");
    onSave();
    onBack();
  }

  function handleDeleteTapped() {
    breadcrumb(`board header: Delete icon tapped (encrypted=${board.encrypted})`);
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before deleting it.", variant: "destructive" });
      return;
    }
    showDeleteConfirm = true;
  }

  function handleDelete() {
    breadcrumb("board header: Delete tapped");
    removeEntry(board.id);
    pushToast({ title: "Board deleted", description: "Your board has been deleted.", variant: "destructive" });
    goto("/");
  }

  // Node ids are load-bearing (edges reference them by id), so a
  // duplicate can't just spread-copy the nodes array the way Note's
  // duplicate copies plain content — every node needs a NEW id (two
  // boards must never share one), and every edge's source/target has
  // to follow the SAME old-id -> new-id mapping or the copy's
  // connections would silently point at the ORIGINAL board's nodes
  // (which then don't exist on this entry at all) instead of its own.
  function handleDuplicate() {
    breadcrumb(`board header: Duplicate tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before duplicating it.", variant: "destructive" });
      return;
    }
    const idMap = new Map(board.nodes.map((n) => [n.id, crypto.randomUUID()]));
    const copy = createBoard();
    copy.title = `${board.title} (Copy)`;
    copy.tags = [...board.tags];
    copy.nodes = board.nodes.map((n) => ({ ...n, id: idMap.get(n.id)! }));
    copy.edges = board.edges.map((e) => ({
      id: crypto.randomUUID(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }));
    copy.viewport = board.viewport ? { ...board.viewport } : null;
    saveEntry(copy);
    goto(`/board/${copy.id}`);
    pushToast({ title: "Board duplicated", description: "Your board has been duplicated." });
  }

  // Same fix, same reasoning as NoteEditorHeader/TodoHeader's identical
  // handleDownload — see NoteEditorHeader.svelte's comment for the full
  // history (downloadFiles() exists to route around a confirmed,
  // still-open Android WebView blob-link limitation).
  function handleDownload() {
    breadcrumb(`board header: Export tapped (encrypted=${board.encrypted})`);
    if (board.encrypted) {
      downloadFiles([buildEncryptedBackupFile(board)]);
      pushToast({ title: "Encrypted backup downloaded", description: "This board is still locked — the file holds only encrypted data, not its readable content." });
      return;
    }
    downloadFiles(buildExportFiles([board], "separate"));
    pushToast({ title: "Board downloaded", description: "Your board has been downloaded as a text file." });
  }

  async function handleShare() {
    breadcrumb(`board header: Share tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before sharing it.", variant: "destructive" });
      return;
    }
    const name = `${board.title || "board"}.txt`;
    const blob = new Blob([entryToPlainText(board)], { type: "text/plain" });
    const result = await shareFiles([{ name, blob }], { title: board.title || "Board" });
    if (result === "shared") {
      pushToast({ title: "Shared" });
    } else if (result !== "cancelled") {
      pushToast({ title: "Sharing isn't available here", description: "Try Export instead." });
    }
  }
</script>

<header class="editor-header" style={headerStyle}>
  <div class="row">
    <Button variant="ghost" size="icon" onclick={handleBack}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
    </Button>

    <div class="actions">
      <Button variant="ghost" size="icon" onclick={handleDeleteTapped} aria-label="Delete">
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

      <Button variant="ghost" size="icon" onclick={() => { breadcrumb("board header: More (...) tapped"); moreOpen = true; }} aria-label="More">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </Button>
    </div>
  </div>

  <TagSelector
    selectedTags={board.tags}
    {availableTags}
    onAddTag={(t) => onTagsChange([...board.tags, t])}
    onRemoveTag={(t) => onTagsChange(board.tags.filter((x) => x !== t))}
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
    <button class="action-row" onclick={handleOpenThemeSheet}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9" /><path d="M12 3a6 6 0 0 0 0 12 3 3 0 0 1 0 6 9 9 0 1 1 0-18z" />
        <circle cx="7.5" cy="10.5" r="1" fill="currentColor" /><circle cx="12" cy="7.5" r="1" fill="currentColor" /><circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
      </svg>
      <span>Theme</span>
    </button>
  </div>
</Sheet>

<ThemeSectionsSheet
  bind:open={themeSheetOpen}
  title="Theme &amp; Icon"
  headerTheme={board.headerTheme}
  bodyTheme={board.bodyTheme}
  icon={board.icon}
  onHeaderChange={handleHeaderThemeChange}
  onBodyChange={handleBodyThemeChange}
  onIconChange={handleIconChange}
/>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete board"
  description="Are you sure you want to delete this board? This can't be undone."
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
    flex-shrink: 0;
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
