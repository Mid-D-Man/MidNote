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
  import { pushToast } from "$lib/stores/toast.svelte";
  import { removeEntry, saveEntry } from "$lib/stores/entries.svelte";
  import { createNote } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { shareFiles } from "$lib/utils/share";
  import { entryToPlainText, buildExportFiles, buildEncryptedBackupFile, downloadFiles } from "$lib/utils/selectionActions";
  import ThemeSectionsSheet from "$lib/components/shared/ThemeSectionsSheet/ThemeSectionsSheet.svelte";
  import PagesPanel from "$lib/components/notes/PagesPanel/PagesPanel.svelte";
  import NoteAiChatSheet from "$lib/components/notes/NoteAiChatSheet/NoteAiChatSheet.svelte";
  import { resolveTheme, hexToRgba, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import type { IconRef, Note, ThemeRef } from "$lib/types/entry";

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
    currentPageIndex,
    onSwitchPage,
    onAddPage,
    onDeletePage,
    onRenamePage,
    onFindReplace,
  }: {
    note: Note;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    onBack: () => void;
    // Page switching itself lives in the route page (it owns the actual
    // content-binding logic — see note/[id]/+page.svelte's
    // currentPageIndex comment); this header just surfaces the entry
    // point (the "Pages" row below) and hands the callbacks down into
    // PagesPanel.
    currentPageIndex: number;
    onSwitchPage: (index: number) => void;
    onAddPage: () => void;
    onDeletePage: (index: number) => void;
    onRenamePage: (index: number, name: string | null) => void;
    // Round 26: opens the docked find & replace bar. The bar needs the
    // live Tiptap editor, which the route page owns (this header never
    // sees it) — so, like page switching above, the header only
    // surfaces the entry point and hands the tap up.
    onFindReplace?: () => void;
  } = $props();

  let isSaving = $state(false);
  let showDeleteConfirm = $state(false);
  let moreOpen = $state(false);
  let commentsOpen = $state(false);
  let exportAsOpen = $state(false);
  let reminderOpen = $state(false);
  let themeSheetOpen = $state(false);
  let aiChatOpen = $state(false);
  let pagesOpen = $state(false);

  // Same resolveTheme() as the card preview — a visible (but
  // deliberately contained, see ThemeSectionsSheet's callsite below)
  // echo of the selected theme in the editor itself, not just the
  // list. Scoped to the header bar only — headerTheme, not bodyTheme:
  // the writing surface (see the route page's own bodyStyle) is a
  // separate, independent slot now.
  const resolvedHeaderTheme = $derived(resolveTheme(note.headerTheme, customThemes));
  const headerStyle = $derived(
    resolvedHeaderTheme.kind === "color"
      ? `background: ${hexToRgba(resolvedHeaderTheme.color, 0.14)}; border-bottom-color: ${resolvedHeaderTheme.color};`
      : resolvedHeaderTheme.kind === "image"
        ? // BUGFIX: the icon buttons (Back/Delete/Save/Export/More) and
          // TagSelector below used to just rely on the fixed 35% scrim
          // plus the app's own normal --text-hi token — genuinely risky
          // for a bright/light header photo, same class of issue as
          // NoteCard's old always-light hack. getImageTextColorVars
          // gives Button.svelte and TagSelector.svelte's own CSS-var
          // fallbacks (see their respective files) the right values to
          // pick up automatically — no :global() overrides needed here.
          `background-image: linear-gradient(rgba(4,6,16,0.35), rgba(4,6,16,0.35)), url(${resolvedHeaderTheme.dataUrl}); background-size: cover; background-position: center; ${getImageTextColorVars(resolvedHeaderTheme.textColor)}`
        : "",
  );

  // BUGFIX (data-safety, same category as handleDeleteTapped below):
  // the "..." sheet's Theme/Pages rows, plus Share/Duplicate, had no
  // lock check at all — a locked note's header renders unconditionally
  // (only the BODY swaps to the placeholder, see /note/[id]/+page.svelte),
  // so all four were reachable and functional on a note that hadn't
  // been unlocked, even though note.content/note.pages are already
  // cleared to empty at that point (see lockFlow.ts's
  // clearPlaintextFields) — Theme/Pages would edit a blank shell that's
  // about to be overwritten by the next unlock, and Share/Duplicate
  // would silently share/copy nothing meaningful. Gated the same way
  // handleDeleteTapped already is: refuse with a toast, don't open
  // anything.
  function handleOpenThemeSheet() {
    breadcrumb(`note header: Theme tapped (encrypted=${note.encrypted})`);
    if (note.encrypted) {
      moreOpen = false;
      pushToast({ title: "Unlock first", description: "Unlock this note before changing its theme.", variant: "destructive" });
      return;
    }
    // Sequential, not nested — same pattern CardOverflowMenu already
    // uses for its delete-confirm flow (close the sheet you're in,
    // open the next one), rather than two Sheets open at once, which
    // Sheet.svelte was never built or tested to support.
    moreOpen = false;
    themeSheetOpen = true;
  }

  // Round 26. Same lock gate as Theme/Pages/Share/Copy: a locked note's
  // body isn't mounted (content is cleared while locked), so there'd be
  // no editor to search — refuse with the same toast instead of opening
  // a bar that can do nothing. Closes the Actions sheet first, same
  // sequential (not nested) pattern as the rows above.
  function handleFindReplace() {
    breadcrumb(`note header: Find & replace tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before searching it.", variant: "destructive" });
      return;
    }
    onFindReplace?.();
  }

  function handleOpenPages() {
    breadcrumb(`note header: Pages tapped (encrypted=${note.encrypted})`);
    if (note.encrypted) {
      moreOpen = false;
      pushToast({ title: "Unlock first", description: "Unlock this note before managing its pages.", variant: "destructive" });
      return;
    }
    moreOpen = false;
    pagesOpen = true;
  }

  // BUGFIX (carried over from the old single-theme version): mutate
  // `note` directly rather than going through the entries STORE's own
  // copy — see /note/[id]/+page.svelte, `note` is loaded via
  // getEntry(), a different object from the store's `entries` array.
  // Mutating this exact reactive object means headerStyle/bodyStyle
  // (both $derived from `note` directly) update immediately; saveEntry()
  // then persists it AND refreshes the entries store so the list view
  // picks up the change too.
  function handleHeaderThemeChange(theme: ThemeRef) {
    note.headerTheme = theme;
    saveEntry(note);
  }
  function handleBodyThemeChange(theme: ThemeRef) {
    note.bodyTheme = theme;
    saveEntry(note);
  }
  function handleIconChange(icon: IconRef | null) {
    note.icon = icon;
    saveEntry(note);
  }

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

  // BUGFIX (data-safety) — same reasoning/fix as CardOverflowMenu's
  // handleDeleteTapped: this icon is always visible in the header
  // regardless of note.encrypted (the header renders unconditionally;
  // only the body swaps to the locked-placeholder screen — see
  // /note/[id]/+page.svelte), so a locked note reached via direct
  // navigation (a bookmark, browser back/forward, anything that skips
  // the landing-page list's own now-gated click handler) could still be
  // deleted here without ever unlocking it first.
  function handleDeleteTapped() {
    breadcrumb(`note header: Delete icon tapped (encrypted=${note.encrypted})`);
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before deleting it.", variant: "destructive" });
      return;
    }
    showDeleteConfirm = true;
  }

  function handleDelete() {
    breadcrumb("note header: Delete tapped");
    removeEntry(note.id);
    pushToast({ title: "Moved to Trash", description: "Your note was moved to Trash.", variant: "destructive" });
    goto("/");
  }

  function handleDuplicate() {
    breadcrumb(`note header: Duplicate tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before duplicating it.", variant: "destructive" });
      return;
    }
    const copy = createNote();
    copy.title = `${note.title} (Copy)`;
    copy.content = note.content;
    copy.tags = [...note.tags];
    saveEntry(copy);
    goto(`/note/${copy.id}`);
    pushToast({ title: "Note duplicated", description: "Your note has been duplicated." });
  }

  // Export/share: Export downloads a .txt of this note; Share hands the
  // exact same text to navigator.share (see share.ts's header comment
  // for the real, stated platform uncertainty around file-sharing
  // support on this specific WebView — feature-detected with a
  // text-only fallback, not assumed to just work).
  //
  // BUGFIX: this used to build its own separate Blob here and hand it
  // to a raw `<a download>` link directly — which, per
  // selectionActions.ts's own extensively-documented downloadFiles()
  // history, is a confirmed, still-open upstream Tauri/Android
  // limitation (tauri-apps/tauri#10280): Android has no way to resolve
  // a path for a blob link's implicit "download," so the tap silently
  // does nothing (or, on some WebView/OS combinations, appears to
  // "succeed" while producing an empty or unreachable file) — exactly
  // the "nothing gets exported, the file is empty" symptom reported.
  // downloadFiles() exists specifically because that technique doesn't
  // work on Android and went through five rounds of on-device
  // debugging to land on what actually does (direct plugin-fs write on
  // desktop, straight to the native save-file picker on
  // Android/mobile) — this button just never got migrated onto it, so
  // it was still hitting the exact bug that function was written to
  // route around. Also drops the separate, slowly-drifting
  // buildExportBlob() this used to have in favor of the same
  // entryToPlainText()/buildExportFiles() the list's multi-select
  // Export already uses, so a single note's content is built exactly
  // one way, not two that can quietly disagree.
  // BUGFIX (data-safety): downloading a locked note used to run this
  // exact same plaintext export path — but by the time a note is
  // locked, note.content/note.pages are already emptied (see
  // lockFlow.ts's clearPlaintextFields), so what actually got exported
  // was an empty/near-empty .txt, not a refusal and not the real
  // content either. Rather than just block Export outright the way
  // Theme/Pages/Share/Duplicate now are above (which would throw away
  // a genuinely useful case — backing up a locked note before, say,
  // reinstalling the app), a locked note now exports its actual stored
  // ciphertext instead: see selectionActions.ts's buildEncryptedBackupFile
  // for what that file contains and why this is safe to allow even
  // while locked.
  function handleDownload() {
    breadcrumb(`note header: Export tapped (encrypted=${note.encrypted})`);
    if (note.encrypted) {
      downloadFiles([buildEncryptedBackupFile(note)]);
      pushToast({ title: "Encrypted backup downloaded", description: "This note is still locked — the file holds only encrypted data, not its readable content." });
      return;
    }
    downloadFiles(buildExportFiles([note], "separate"));
    pushToast({ title: "Note downloaded", description: "Your note has been downloaded as a text file." });
  }

  async function handleShare() {
    breadcrumb(`note header: Share tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before sharing it.", variant: "destructive" });
      return;
    }
    const name = `${note.title || "note"}.txt`;
    const blob = new Blob([entryToPlainText(note)], { type: "text/plain" });
    const result = await shareFiles([{ name, blob }], { title: note.title || "Note" });
    if (result === "shared") {
      pushToast({ title: "Shared" });
    } else if (result !== "cancelled") {
      pushToast({ title: "Sharing isn't available here", description: "Try Export instead." });
    }
  }

  // Same encrypted-gating reasoning as Theme/Pages/Share/Duplicate above
  // — content is already cleared while locked, so this would silently
  // copy nothing useful rather than the note's real text.
  async function handleCopyContents() {
    breadcrumb(`note header: Copy contents tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before copying its contents.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(entryToPlainText(note));
      pushToast({ title: "Copied", description: "This note's contents are on your clipboard." });
    } catch (err) {
      console.error("note header: clipboard write failed:", err);
      pushToast({ title: "Couldn't copy", description: "Clipboard access isn't available right now.", variant: "destructive" });
    }
  }

  // Round 29: Pin in the Actions sheet (it already existed on the list
  // card's overflow menu, but not from inside the editor). Same pattern as
  // the theme/icon handlers above: mutate THIS editor's own `note` (the
  // getEntry() copy, not the entries store's) and saveEntry() it, so the
  // list re-sorts AND the editor's later autosave can't overwrite the pin
  // with a stale value. Gated on the lock like Theme/Share/Copy — a locked
  // entry's editor copy is a placeholder and shouldn't be re-saved from here.
  function handleTogglePin() {
    breadcrumb(`note header: Pin tapped (encrypted=${note.encrypted}, pinned=${note.isPinned})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before pinning it.", variant: "destructive" });
      return;
    }
    note.isPinned = !note.isPinned;
    saveEntry(note);
    pushToast({
      title: note.isPinned ? "Pinned" : "Unpinned",
      description: note.isPinned ? "This note will stay at the top of your list." : "This note is back in its normal place.",
    });
  }

  // Round 29: STUB entry point for chatting with AI about this note. Same
  // lock gate and same sequential close-then-open Sheet pattern as Theme.
  function handleAskAi() {
    breadcrumb(`note header: Ask AI tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before chatting about it.", variant: "destructive" });
      return;
    }
    aiChatOpen = true;
  }

  // Round 30: Comments and Export as… in the Actions sheet. Same lock gate
  // and same close-then-open (never nested) Sheet pattern as Theme/Pin: a
  // locked entry's content and comments are cleared on the visible record,
  // so there is nothing to show or export until it's unlocked.
  function handleOpenComments() {
    breadcrumb(`note header: Comments tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before opening its comments.", variant: "destructive" });
      return;
    }
    commentsOpen = true;
  }

  function handleOpenExportAs() {
    breadcrumb(`note header: Export as tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before exporting it as a document.", variant: "destructive" });
      return;
    }
    exportAsOpen = true;
  }

  // Round 31: Reminder. Same lock gate and close-then-open Sheet pattern as
  // Comments / Export as — a locked entry's editor copy is a placeholder, so
  // it isn't re-saved from here; unlock first. (Locking an entry that
  // already HAS a reminder is handled in lockFlow.ts.)
  function handleOpenReminder() {
    breadcrumb(`note header: Reminder tapped (encrypted=${note.encrypted})`);
    moreOpen = false;
    if (note.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this note before setting a reminder on it.", variant: "destructive" });
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

<CommentsSheet bind:open={commentsOpen} entry={note} />
<ExportAsSheet bind:open={exportAsOpen} entry={note} />
<ReminderSheet bind:open={reminderOpen} entry={note} />

<Sheet bind:open={moreOpen} side="bottom" title="Actions">
  <div class="action-list">
    <button class="action-row" onclick={handleTogglePin} aria-label={note.isPinned ? "Unpin note" : "Pin note"}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill={note.isPinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
        <path d="M12 17v5" /><path d="M9 3h6l-1 7 3 3H7l3-3z" />
      </svg>
      <span>{note.isPinned ? "Unpin" : "Pin to top"}</span>
    </button>
    <button class="action-row" onclick={handleOpenComments} aria-label="Comments">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      <span>Comments{note.comments.length > 0 ? ` (${note.comments.length})` : ""}</span>
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
      <span>{isActiveReminder(note.reminderAt) ? `Reminder · ${formatReminderWhen(note.reminderAt as string)}` : "Reminder"}</span>
    </button>
    <button class="action-row" onclick={handleFindReplace} aria-label="Find and replace">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
      <span>Find &amp; replace</span>
    </button>
    <button class="action-row" onclick={handleAskAi} aria-label="Ask AI">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
      </svg>
      <span>Ask AI</span>
    </button>
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
    <button class="action-row" onclick={handleOpenPages}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      </svg>
      <span>Pages{note.pages.length > 0 ? ` (${1 + note.pages.length})` : ""}</span>
    </button>
  </div>
</Sheet>

<NoteAiChatSheet bind:open={aiChatOpen} noteTitle={note.title} />
<PagesPanel bind:open={pagesOpen} {note} {currentPageIndex} {onSwitchPage} {onAddPage} {onDeletePage} {onRenamePage} />

<ThemeSectionsSheet
  bind:open={themeSheetOpen}
  title="Theme &amp; Icon"
  headerTheme={note.headerTheme}
  bodyTheme={note.bodyTheme}
  icon={note.icon}
  onHeaderChange={handleHeaderThemeChange}
  onBodyChange={handleBodyThemeChange}
  onIconChange={handleIconChange}
/>


<!-- BUGFIX (round 25): Delete is a soft delete now — see
     entries.svelte.ts's removeEntry -> storage.moveToTrash. Copy/label
     updated so this dialog stops promising something no longer true;
     nothing else about the flow changed. -->
<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete note"
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
