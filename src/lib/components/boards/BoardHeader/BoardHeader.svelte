<!--
  Board's editor header. Deliberately kept as close to NoteEditorHeader's
  shape as possible — same icon row, same "..." Actions sheet, same
  TagSelector/ThemeSectionsSheet/ConfirmDialog trio — rather than
  inventing a fourth slightly-different header pattern. The one
  structural difference: no Pages row, since a board has no page
  concept; nodes/edges are its content instead.
-->
<script lang="ts">
  import CommentsSheet from "$lib/components/shared/CommentsSheet/CommentsSheet.svelte";
  import ExportAsSheet from "$lib/components/shared/ExportAsSheet/ExportAsSheet.svelte";
  import ReminderSheet from "$lib/components/shared/ReminderSheet/ReminderSheet.svelte";
  import { isActiveReminder, formatReminderWhen } from "$lib/utils/reminders";
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
  import { toggleReadAloud, readAloud, stopReadingFor } from "$lib/stores/readAloud.svelte";
  import { onDestroy } from "svelte";
  import { copyAppearance } from "$lib/utils/duplicate";
  import { shareText, shareOutcomeToast } from "$lib/utils/share";
  import { entryToPlainText, buildExportFiles, buildEncryptedBackupFile, downloadFiles } from "$lib/utils/selectionActions";
  import { resolveTheme, hexToRgba, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import type { Board, IconRef, ThemeRef } from "$lib/types/entry";

  let {
    board,
    availableTags,
    onTagsChange,
    onSave,
    onPersist,
    onBack,
  }: {
    board: Board;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    // Silent save (no toast/spinner) for the title field's onblur — see
    // the title <input> below. Separate from onSave, which is the
    // explicit Save button and deliberately DOES show one.
    onPersist: () => void;
    onBack: () => void;
  } = $props();

  let isSaving = $state(false);
  let showDeleteConfirm = $state(false);
  let moreOpen = $state(false);
  let commentsOpen = $state(false);
  let exportAsOpen = $state(false);
  let reminderOpen = $state(false);
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
    pushToast({ title: "Moved to Trash", description: "Your board was moved to Trash.", variant: "destructive" });
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
      label: e.label, // round 38: captions and arrows used to be dropped
      directed: e.directed,
    }));
    copy.viewport = board.viewport ? { ...board.viewport } : null;
    copyAppearance(board, copy); // round 34: themes + icon used to be dropped
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
    // Round 34: opens the "Export as" picker (see NoteEditorHeader). A locked
    // board still takes the encrypted-backup path above.
    exportAsOpen = true;
  }

  // Round 37: read this entry aloud through the phone's speech engine, or stop it
  // if it is the one being read. The reading must not outlive the editor that
  // started it, so it stops when this page goes away.
  const isReading = $derived(readAloud.status !== "idle" && readAloud.id === board.id);
  async function handleReadAloud() {
    moreOpen = false;
    await toggleReadAloud(board);
  }
  onDestroy(() => stopReadingFor(board.id));

  async function handleShare() {
    breadcrumb(`board header: Share tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before sharing it.", variant: "destructive" });
      return;
    }
    const result = await shareText(entryToPlainText(board), { title: board.title || "Board", log: breadcrumb });
    breadcrumb(`board header: Share -> ${result}`);
    const toast = shareOutcomeToast(result);
    if (toast) pushToast(toast);
  }

  // Same encrypted-gating reasoning as this header's other content
  // actions — nodes/edges are already cleared while locked. Reuses
  // entryToPlainText's board branch (a readable node + connection
  // inventory — see selectionActions.ts), the same text Export/Share
  // already produce for a board.
  async function handleCopyContents() {
    breadcrumb(`board header: Copy contents tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before copying its contents.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(entryToPlainText(board));
      pushToast({ title: "Copied", description: "This board's contents are on your clipboard." });
    } catch (err) {
      console.error("board header: clipboard write failed:", err);
      pushToast({ title: "Couldn't copy", description: "Clipboard access isn't available right now.", variant: "destructive" });
    }
  }

  // Round 29: Pin in the Actions sheet (it already existed on the list
  // card's overflow menu, but not from inside the editor). Same pattern as
  // the theme/icon handlers above: mutate THIS editor's own `board` (the
  // getEntry() copy, not the entries store's) and saveEntry() it, so the
  // list re-sorts AND the editor's later autosave can't overwrite the pin
  // with a stale value. Gated on the lock like Theme/Share/Copy — a locked
  // entry's editor copy is a placeholder and shouldn't be re-saved from here.
  function handleTogglePin() {
    breadcrumb(`board header: Pin tapped (encrypted=${board.encrypted}, pinned=${board.isPinned})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before pinning it.", variant: "destructive" });
      return;
    }
    board.isPinned = !board.isPinned;
    saveEntry(board);
    pushToast({
      title: board.isPinned ? "Pinned" : "Unpinned",
      description: board.isPinned ? "This board will stay at the top of your list." : "This board is back in its normal place.",
    });
  }

  // Round 30: Comments and Export as… in the Actions sheet. Same lock gate
  // and same close-then-open (never nested) Sheet pattern as Theme/Pin: a
  // locked entry's content and comments are cleared on the visible record,
  // so there is nothing to show or export until it's unlocked.
  function handleOpenComments() {
    breadcrumb(`board header: Comments tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before opening its comments.", variant: "destructive" });
      return;
    }
    commentsOpen = true;
  }

  function handleOpenExportAs() {
    breadcrumb(`board header: Export as tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before exporting it as a document.", variant: "destructive" });
      return;
    }
    exportAsOpen = true;
  }

  // Round 31: Reminder. Same lock gate and close-then-open Sheet pattern as
  // Comments / Export as — a locked entry's editor copy is a placeholder, so
  // it isn't re-saved from here; unlock first. (Locking an entry that
  // already HAS a reminder is handled in lockFlow.ts.)
  function handleOpenReminder() {
    breadcrumb(`board header: Reminder tapped (encrypted=${board.encrypted})`);
    moreOpen = false;
    if (board.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this board before setting a reminder on it.", variant: "destructive" });
      return;
    }
    reminderOpen = true;
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

  <!-- BUGFIX: title editing went missing entirely when this header
       replaced the board route's old ad hoc one — that inline header had
       its own title <input>, and this component's icon-row-plus-tags
       layout was built to replace it without carrying that field along.
       bind:value straight to board.title, same pattern NoteTitle.svelte
       already uses for note.title — `board` is the same $state object
       the route holds, so this mutates it directly; onblur just needs to
       trigger persistence (silently — onSave is the separate, explicit,
       toast-showing Save button). -->
  <input
    type="text"
    bind:value={board.title}
    onblur={onPersist}
    placeholder="Board title..."
    class="board-title"
  />

  <TagSelector
    selectedTags={board.tags}
    {availableTags}
    onAddTag={(t) => onTagsChange([...board.tags, t])}
    onRemoveTag={(t) => onTagsChange(board.tags.filter((x) => x !== t))}
  />
</header>

<CommentsSheet bind:open={commentsOpen} entry={board} />
<ExportAsSheet bind:open={exportAsOpen} entry={board} />
<ReminderSheet bind:open={reminderOpen} entry={board} />

<Sheet bind:open={moreOpen} side="bottom" title="Actions">
  <div class="action-list">
    <button class="action-row" onclick={handleTogglePin} aria-label={board.isPinned ? "Unpin board" : "Pin board"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill={board.isPinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
        <path d="M12 17v5" /><path d="M9 3h6l-1 7 3 3H7l3-3z" />
      </svg>
      <span>{board.isPinned ? "Unpin" : "Pin to top"}</span>
    </button>
    <button class="action-row" onclick={handleOpenComments} aria-label="Comments">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      <span>Comments{board.comments.length > 0 ? ` (${board.comments.length})` : ""}</span>
    </button>
    <button class="action-row" onclick={handleOpenExportAs} aria-label="Export as">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /><line x1="9" y1="14" x2="15" y2="14" /><line x1="9" y1="17.5" x2="13" y2="17.5" />
      </svg>
      <span>Export as…</span>
    </button>
    <button class="action-row" onclick={handleOpenReminder} aria-label="Reminder">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      <span>{isActiveReminder(board.reminderAt) ? `Reminder · ${formatReminderWhen(board.reminderAt as string)}` : "Reminder"}</span>
    </button>
    <button class="action-row" onclick={handleReadAloud} aria-label={isReading ? "Stop reading" : "Read aloud"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" />
      </svg>
      <span>{isReading ? "Stop reading" : "Read aloud"}</span>
    </button>
    <button class="action-row" onclick={handleShare} aria-label="Share">
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
    <button class="action-row" onclick={handleCopyContents}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
      </svg>
      <span>Copy contents</span>
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
  icon={board.icon}
  onHeaderChange={handleHeaderThemeChange}
  onIconChange={handleIconChange}
  headerDescription="The card in the list, and this board's own top bar."
/>


<!-- BUGFIX (round 25): soft delete now, see NoteEditorHeader.svelte's
     identical comment. -->
<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete board"
  description="You can restore it from Trash for the next 30 days, or delete it for good from there."
  confirmLabel="Move to Trash"
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
  .board-title {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--theme-text-hi, var(--text-hi));
    font-size: 17px;
    font-weight: 600;
    font-family: inherit;
  }
  .board-title::placeholder {
    color: var(--theme-text-lo, var(--text-faint));
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
