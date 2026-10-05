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
  import { createTodo } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { toggleReadAloud, readAloud, stopReadingFor } from "$lib/stores/readAloud.svelte";
  import { onDestroy } from "svelte";
  import { copyAppearance } from "$lib/utils/duplicate";
  import { shareText, shareOutcomeToast } from "$lib/utils/share";
  import { resolveTheme, hexToRgba, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import { buildExportFiles, buildEncryptedBackupFile, downloadFiles, entryToPlainText } from "$lib/utils/selectionActions";
  import type { IconRef, Todo, ThemeRef } from "$lib/types/entry";

  let {
    todo,
    availableTags,
    onTagsChange,
    onSave,
    onBack,
    onShowNotes,
  }: {
    todo: Todo;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    onBack: () => void;
    onShowNotes: () => void;
  } = $props();

  let isSaving = $state(false);
  let showDeleteConfirm = $state(false);
  // REVISION: Actions moved from a DropdownMenu into a bottom Sheet,
  // Share folded in alongside Duplicate/Download instead of its own
  // standalone row-level icon — brings this header to the same
  // structure NoteEditorHeader already uses, which is also what makes
  // "the theme picker lives in the same place as Share" (direct
  // request) actually true for todos, not just notes: before this,
  // Share and Duplicate/Download lived in two different places on this
  // specific header, so there was no single "same place as Share" to
  // put Theme into without picking one first.
  let moreOpen = $state(false);
  let commentsOpen = $state(false);
  let exportAsOpen = $state(false);
  let reminderOpen = $state(false);
  let themeSheetOpen = $state(false);

  const resolvedHeaderTheme = $derived(resolveTheme(todo.headerTheme, customThemes));
  const headerStyle = $derived(
    resolvedHeaderTheme.kind === "color"
      ? `background: ${hexToRgba(resolvedHeaderTheme.color, 0.14)}; border-bottom-color: ${resolvedHeaderTheme.color};`
      : resolvedHeaderTheme.kind === "image"
        ? // Same fix as NoteEditorHeader.svelte's identical headerStyle
          // — see that file's comment for the full reasoning.
          `background-image: linear-gradient(rgba(4,6,16,0.35), rgba(4,6,16,0.35)), url(${resolvedHeaderTheme.dataUrl}); background-size: cover; background-position: center; ${getImageTextColorVars(resolvedHeaderTheme.textColor)}`
        : "",
  );

  // BUGFIX (data-safety, same category as handleDeleteTapped below and
  // as NoteEditorHeader.svelte's identical gates) — see that file's
  // comment for the full reasoning: this header renders unconditionally
  // for a locked todo (only the body swaps to the placeholder), so
  // Theme/Duplicate/Share/Download were all reachable and functional on
  // a todo that hadn't been unlocked yet, operating on already-cleared
  // steps/annotations (see lockFlow.ts's clearPlaintextFields).
  function handleOpenThemeSheet() {
    breadcrumb(`todo header: Theme tapped (encrypted=${todo.encrypted})`);
    if (todo.encrypted) {
      moreOpen = false;
      pushToast({ title: "Unlock first", description: "Unlock this todo before changing its theme.", variant: "destructive" });
      return;
    }
    moreOpen = false;
    themeSheetOpen = true;
  }

  // BUGFIX — see NoteEditorHeader.svelte's identical comment: `todo`
  // here is /todo/[id]/+page.svelte's own local $state (loaded via
  // getEntry()), a different object from the entries store's array
  // item. The old setEntryTheme(todo.id, theme) mutated the wrong one.
  function handleHeaderThemeChange(theme: ThemeRef) {
    todo.headerTheme = theme;
    saveEntry(todo);
  }
  function handleBodyThemeChange(theme: ThemeRef) {
    todo.bodyTheme = theme;
    saveEntry(todo);
  }
  function handleIconChange(icon: IconRef | null) {
    todo.icon = icon;
    saveEntry(todo);
  }

  async function handleSave() {
    isSaving = true;
    onSave();
    pushToast({ title: "Todo saved", description: "Your todo has been saved successfully." });
    setTimeout(() => (isSaving = false), 400);
  }

  function handleBack() {
    onSave();
    onBack();
  }

  // BUGFIX (data-safety) — same fix as NoteEditorHeader.svelte's
  // identical handleDeleteTapped; see that file's comment for why this
  // icon needs its own gate despite the landing-page list already being
  // gated (direct navigation to a locked todo's editor route skips
  // that).
  function handleDeleteTapped() {
    breadcrumb(`todo header: Delete icon tapped (encrypted=${todo.encrypted})`);
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before deleting it.", variant: "destructive" });
      return;
    }
    showDeleteConfirm = true;
  }

  function handleDelete() {
    removeEntry(todo.id);
    pushToast({ title: "Moved to Trash", description: "Your todo was moved to Trash.", variant: "destructive" });
    goto("/");
  }

  function handleDuplicate() {
    breadcrumb(`todo header: Duplicate tapped (encrypted=${todo.encrypted})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before duplicating it.", variant: "destructive" });
      return;
    }
    const copy = createTodo();
    copy.title = `${todo.title} (Copy)`;
    copy.tags = [...todo.tags];
    copy.categories = [...todo.categories];
    copy.steps = todo.steps.map((s) => ({ ...s, id: crypto.randomUUID() }));
    copy.annotations = todo.annotations.map((a) => ({ ...a, id: crypto.randomUUID() }));
    copyAppearance(todo, copy); // round 34: themes + icon used to be dropped
    saveEntry(copy);
    goto(`/todo/${copy.id}`);
    pushToast({ title: "Todo duplicated", description: "Your todo has been duplicated." });
  }

  // BUGFIX: same real bug, same fix, as NoteEditorHeader.svelte's
  // identical handleDownload — see that file's comment for the full
  // history. Short version: the raw `<a download>` blob-link technique
  // this used doesn't work on Android (confirmed, still-open upstream
  // Tauri limitation, tauri-apps/tauri#10280) — downloadFiles() in
  // selectionActions.ts exists specifically to route around it, and
  // this button just never got migrated onto it. Also drops this
  // function's own hand-rolled text-building (which quietly duplicated,
  // and could drift from, entryToPlainText's todo branch) in favor of
  // that same shared function.
  // BUGFIX (data-safety) — same fix and same reasoning as
  // NoteEditorHeader.svelte's identical handleDownload: a locked todo's
  // steps/annotations are already cleared (see lockFlow.ts's
  // clearPlaintextFields), so the plaintext export path would either
  // produce a near-empty file or, once fixed to check, need to refuse
  // outright — which would throw away backing up a locked todo before
  // it's unlocked. Downloads the actual stored ciphertext instead; see
  // selectionActions.ts's buildEncryptedBackupFile.
  function handleDownload() {
    breadcrumb(`todo header: Download tapped (encrypted=${todo.encrypted})`);
    if (todo.encrypted) {
      downloadFiles([buildEncryptedBackupFile(todo)]);
      pushToast({ title: "Encrypted backup downloaded", description: "This todo is still locked — the file holds only encrypted data, not its readable content." });
      return;
    }
    // Round 34: opens the "Export as" picker (see NoteEditorHeader). A locked
    // todo still takes the encrypted-backup path above.
    exportAsOpen = true;
  }

  // Round 37: read this entry aloud through the phone's speech engine, or stop it
  // if it is the one being read. The reading must not outlive the editor that
  // started it, so it stops when this page goes away.
  const isReading = $derived(readAloud.status !== "idle" && readAloud.id === todo.id);
  async function handleReadAloud() {
    moreOpen = false;
    await toggleReadAloud(todo);
  }
  onDestroy(() => stopReadingFor(todo.id));

  async function handleShare() {
    breadcrumb(`todo header: Share tapped (encrypted=${todo.encrypted})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before sharing it.", variant: "destructive" });
      return;
    }
    const result = await shareText(entryToPlainText(todo), { title: todo.title || "Todo", log: breadcrumb });
    breadcrumb(`todo header: Share -> ${result}`);
    const toast = shareOutcomeToast(result);
    if (toast) pushToast(toast);
  }

  // Same encrypted-gating reasoning as this header's other content
  // actions — steps/annotations are already cleared while locked.
  async function handleCopyContents() {
    breadcrumb(`todo header: Copy contents tapped (encrypted=${todo.encrypted})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before copying its contents.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(entryToPlainText(todo));
      pushToast({ title: "Copied", description: "This todo's contents are on your clipboard." });
    } catch (err) {
      console.error("todo header: clipboard write failed:", err);
      pushToast({ title: "Couldn't copy", description: "Clipboard access isn't available right now.", variant: "destructive" });
    }
  }

  // Round 29: Pin in the Actions sheet (it already existed on the list
  // card's overflow menu, but not from inside the editor). Same pattern as
  // the theme/icon handlers above: mutate THIS editor's own `todo` (the
  // getEntry() copy, not the entries store's) and saveEntry() it, so the
  // list re-sorts AND the editor's later autosave can't overwrite the pin
  // with a stale value. Gated on the lock like Theme/Share/Copy — a locked
  // entry's editor copy is a placeholder and shouldn't be re-saved from here.
  function handleTogglePin() {
    breadcrumb(`todo header: Pin tapped (encrypted=${todo.encrypted}, pinned=${todo.isPinned})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before pinning it.", variant: "destructive" });
      return;
    }
    todo.isPinned = !todo.isPinned;
    saveEntry(todo);
    pushToast({
      title: todo.isPinned ? "Pinned" : "Unpinned",
      description: todo.isPinned ? "This todo will stay at the top of your list." : "This todo is back in its normal place.",
    });
  }

  // Round 30: Comments and Export as… in the Actions sheet. Same lock gate
  // and same close-then-open (never nested) Sheet pattern as Theme/Pin: a
  // locked entry's content and comments are cleared on the visible record,
  // so there is nothing to show or export until it's unlocked.
  function handleOpenComments() {
    breadcrumb(`todo header: Comments tapped (encrypted=${todo.encrypted})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before opening its comments.", variant: "destructive" });
      return;
    }
    commentsOpen = true;
  }

  function handleOpenExportAs() {
    breadcrumb(`todo header: Export as tapped (encrypted=${todo.encrypted})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before exporting it as a document.", variant: "destructive" });
      return;
    }
    exportAsOpen = true;
  }

  // Round 31: Reminder. Same lock gate and close-then-open Sheet pattern as
  // Comments / Export as — a locked entry's editor copy is a placeholder, so
  // it isn't re-saved from here; unlock first. (Locking an entry that
  // already HAS a reminder is handled in lockFlow.ts.)
  function handleOpenReminder() {
    breadcrumb(`todo header: Reminder tapped (encrypted=${todo.encrypted})`);
    moreOpen = false;
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before setting a reminder on it.", variant: "destructive" });
      return;
    }
    reminderOpen = true;
  }
</script>

<header class="todo-header" style={headerStyle}>
  <div class="row">
    <Button variant="ghost" size="icon" aria-label="Back" onclick={handleBack}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
    </Button>

    <div class="actions">
      <Button variant="ghost" size="icon" onclick={onShowNotes}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </Button>

      <Button variant="ghost" size="icon" onclick={handleDeleteTapped}>
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

      <Button variant="ghost" size="icon" onclick={() => (moreOpen = true)} aria-label="More">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </Button>
    </div>
  </div>

  <TagSelector
    selectedTags={todo.tags}
    {availableTags}
    onAddTag={(t) => onTagsChange([...todo.tags, t])}
    onRemoveTag={(t) => onTagsChange(todo.tags.filter((x) => x !== t))}
  />
</header>

<CommentsSheet bind:open={commentsOpen} entry={todo} />
<ExportAsSheet bind:open={exportAsOpen} entry={todo} />
<ReminderSheet bind:open={reminderOpen} entry={todo} />

<Sheet bind:open={moreOpen} side="bottom" title="Actions">
  <div class="action-list">
    <button class="action-row" onclick={handleTogglePin} aria-label={todo.isPinned ? "Unpin todo" : "Pin todo"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill={todo.isPinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
        <path d="M12 17v5" /><path d="M9 3h6l-1 7 3 3H7l3-3z" />
      </svg>
      <span>{todo.isPinned ? "Unpin" : "Pin to top"}</span>
    </button>
    <button class="action-row" onclick={handleOpenComments} aria-label="Comments">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      <span>Comments{todo.comments.length > 0 ? ` (${todo.comments.length})` : ""}</span>
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
      <span>{isActiveReminder(todo.reminderAt) ? `Reminder · ${formatReminderWhen(todo.reminderAt as string)}` : "Reminder"}</span>
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
    <button class="action-row" onclick={handleDownload}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
      </svg>
      <span>Download as text</span>
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
  headerTheme={todo.headerTheme}
  bodyTheme={todo.bodyTheme}
  icon={todo.icon}
  onHeaderChange={handleHeaderThemeChange}
  onBodyChange={handleBodyThemeChange}
  onIconChange={handleIconChange}
/>


<!-- BUGFIX (round 25): soft delete now, see NoteEditorHeader.svelte's
     identical comment. -->
<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete todo"
  description="You can restore it from Trash for the next 30 days, or delete it for good from there."
  confirmLabel="Move to Trash"
  danger
  onconfirm={handleDelete}
/>

<style>
  .todo-header {
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
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
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
