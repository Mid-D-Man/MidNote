<script lang="ts">
  // REVISION — see NoteContent.svelte's header comment for the full
  // reasoning. What that migration removes from THIS file specifically:
  // pendingFormats, capturedFormatRange, lastAutoFormatPos/
  // lastKnownCaretPos, formatPickerOpen, refreshFormatState/
  // resetFormatState, handleFormat/handleFontSizeChange/
  // handleColorChange/handleBackgroundColorChange, and the entire
  // hand-rolled undo/redo stack (undoStack/redoStack/checkpointTimer) —
  // all of it was either directly compensating for execCommand's
  // unreliable state tracking or duplicating something Tiptap's own
  // History extension already does natively. FormattingToolbar now
  // calls editor.chain().focus()....run() directly; this file just
  // hands it the live editor instance.
  import { page } from "$app/stores";
  import { goto, onNavigate } from "$app/navigation";
  import { onMount, untrack } from "svelte";
  import type { Editor } from "@tiptap/core";
  import NoteEditorHeader from "$lib/components/notes/NoteEditorHeader/NoteEditorHeader.svelte";
  import NoteTitle from "$lib/components/notes/NoteTitle/NoteTitle.svelte";
  import NoteContent from "$lib/components/notes/NoteContent/NoteContent.svelte";
  import FormattingToolbar from "$lib/components/notes/FormattingToolbar/FormattingToolbar.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { noteTags, sync as syncTags } from "$lib/stores/tags.svelte";
  import { fontSize } from "$lib/stores/settings.svelte";
  import { createNote, getEntry, generateId } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { stripHtml } from "$lib/utils/richText";
  import { unlockForSession, relockSilently } from "$lib/utils/lockFlow";
  import { resolveTheme, hexToRgba } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import type { LockKeyMode, Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let loadError = $state<string | null>(null);
  // 0 = note.content ("Page 1"), 1+ = note.pages[index - 1] — see
  // entry.ts's Note.pages comment for why content itself stays "page 1"
  // rather than everything living in one pages array.
  let currentPageIndex = $state(0);

  // The live Tiptap instance and its reactivity signal, handed up from
  // NoteContent — see that file's header comment for why `tick` needs
  // to exist alongside `editor`. hasSelection is likewise handed up
  // rather than derived here, since NoteContent already computes it
  // straight from editor.state.selection on every transaction.
  let editor = $state<Editor | null>(null);
  let tick = $state(0);
  let hasSelection = $state(false);

  // Tells NoteContent when to reinitialize the editor from note.content
  // — bumped on note load only. Undo/redo no longer touches this at
  // all: it's Tiptap's own History extension now, scoped to the live
  // editor instance, not a page-level content-snapshot stack.
  let syncToken = $state(0);

  onMount(() => {
    breadcrumb(`note page mounted, id=${id}`);
    syncTags();
    load();

    const saveIfHidden = () => {
      if (document.visibilityState === "hidden") {
        breadcrumb("note: auto-saving on visibilitychange (hidden)");
        persist();
      }
    };
    const saveOnPagehide = () => {
      breadcrumb("note: auto-saving on pagehide");
      persist();
    };
    document.addEventListener("visibilitychange", saveIfHidden);
    window.addEventListener("pagehide", saveOnPagehide);
    return () => {
      document.removeEventListener("visibilitychange", saveIfHidden);
      window.removeEventListener("pagehide", saveOnPagehide);
    };
  });

  // SECURITY FIX: opening a locked note previously called the same
  // function the kebab menu's "Unlock" action uses to PERMANENTLY strip
  // a lock — so just tapping in to look, even without editing anything,
  // silently and permanently decrypted it, and nothing ever re-locked
  // it afterward (which is also why it could then be deleted from the
  // list without ever unlocking it there — by that point it genuinely
  // wasn't encrypted anymore). handleUnlock below now uses
  // unlockForSession() instead, which decrypts identically but hands
  // back the password/mode used; this hook puts the lock back — no
  // second password prompt — the moment the user actually navigates
  // away, using whichever entry was captured at unlock time (NOT the
  // `note` variable directly, since that gets reassigned the instant
  // `load()` runs for a different id — see relockCreds below).
  //
  // onNavigate (not beforeNavigate) specifically: it supports delaying
  // the navigation on a returned promise, so the re-lock genuinely
  // finishes before the old page goes away, rather than needing a
  // cancel-then-resume dance. Known, unavoidable gap: if the app is
  // killed/backgrounded (OS process teardown, not an in-app
  // navigation) before this fires, the entry is left unlocked at rest
  // — same as autosave-while-editing already leaves it today, not a
  // new regression, just not something an async hook can guarantee
  // through a process kill.
  let relockCreds = $state<{ entry: Note; password: string; mode: LockKeyMode } | null>(null);

  onNavigate(async () => {
    const creds = relockCreds;
    if (!creds) return;
    relockCreds = null;
    if (!getEntry(creds.entry.id)) return; // deleted from inside the editor — nothing to relock
    await relockSilently(creds.entry, creds.password, creds.mode);
  });

  $effect(() => {
    breadcrumb(`note page effect: id=${id}`);
    load();
  });

  function load() {
    try {
      loadError = null;
      currentPageIndex = 0;
      if (!id || id === "new") {
        note = createNote();
        syncToken = untrack(() => syncToken) + 1;
        return;
      }
      const existing = getEntry(id);
      if (existing && existing.type === "regular") {
        note = existing;
        syncToken = untrack(() => syncToken) + 1;
        breadcrumb(`note: loaded ${id}`);
      } else {
        breadcrumb(`note: ${id} not found or wrong type, redirecting home`);
        goto("/");
      }
    } catch (err) {
      console.error("note page: load() threw:", err);
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function persist() {
    // note.content's default is "<div><br></div>", not "" (see
    // storage.ts) — stripHtml it before checking emptiness, or a
    // never-touched new note would look non-empty and get saved anyway.
    // BUGFIX: also check note.pages — a note with real content ONLY on
    // page 2+ (title and page 1 both still empty) is NOT actually empty,
    // and skipping the save here would silently discard it.
    const hasAnyContent = stripHtml(note.content) || note.pages.some((p) => stripHtml(p.content));
    if (!note.title.trim() && !hasAnyContent) return;
    saveEntry(note);
  }

  function setTags(tags: string[]) {
    note.tags = tags;
    persist();
  }

  // Switching pages reinitializes NoteContent's Tiptap editor from
  // whichever page is now bound (see the {#if currentPageIndex === 0}
  // block below) — same syncToken mechanism already used for loading a
  // different note entirely (see NoteContent.svelte's syncToken comment).
  // persist() first so whatever's on the page being switched AWAY from
  // isn't lost if the user backs out before the next autosave point.
  function switchToPage(index: number) {
    persist();
    currentPageIndex = index;
    syncToken = untrack(() => syncToken) + 1;
  }

  function addPage() {
    persist();
    const newPage = { id: generateId(), content: "", name: null };
    note.pages = [...note.pages, newPage];
    currentPageIndex = note.pages.length; // the page just added
    syncToken = untrack(() => syncToken) + 1;
    saveEntry(note);
  }

  // BEHAVIOR CHANGE (explicit request): this used to hard-block deleting
  // page 1 specifically, on any page. What should actually be
  // undeletable is whichever page you're CURRENTLY viewing — deleting
  // the page you're looking at out from under yourself is the confusing
  // case, not page 1 specifically. Page 1 is deletable now too, just
  // not while it's the one open — see PagesPanel.svelte's matching
  // `i !== currentPageIndex` guard on the delete button itself.
  //
  // Page 1 isn't a NotePage object (see entry.ts's Note.pages comment)
  // so deleting it specifically means promoting the next page (today's
  // pages[0]) into note.content/page1Name's place, then dropping it
  // from the array — everything else about it (id, content, name)
  // moves as-is, nothing is regenerated or lost.
  function deletePage(index: number) {
    if (index === currentPageIndex) return; // can't delete the page you're currently on
    if (index === 0) {
      const [promoted, ...rest] = note.pages;
      note.content = promoted.content;
      note.page1Name = promoted.name;
      note.pages = rest;
    } else {
      const pageArrayIndex = index - 1;
      note.pages = note.pages.filter((_, i) => i !== pageArrayIndex);
    }
    if (currentPageIndex > index) {
      // A page before the one you're viewing was removed — every index
      // from here on shifts down by one to keep pointing at the same
      // actual page (same id/content) it did before the delete, even
      // though its position in the array (and therefore its
      // currentPageIndex) moved. The underlying NoteContent binding
      // (note.pages[currentPageIndex - 1]) needs a fresh syncToken here
      // too, same as switchToPage — the object being edited hasn't
      // changed, but which array slot Svelte is reading it through has.
      currentPageIndex -= 1;
      syncToken = untrack(() => syncToken) + 1;
    }
    saveEntry(note);
  }

  function renamePage(index: number, name: string | null) {
    breadcrumb(`note: rename page ${index + 1}`);
    if (index === 0) {
      note.page1Name = name;
    } else {
      const pageArrayIndex = index - 1;
      const target = note.pages[pageArrayIndex];
      if (!target) return;
      note.pages = note.pages.map((p, i) => (i === pageArrayIndex ? { ...p, name } : p));
    }
    saveEntry(note);
  }

  let unlocking = $state(false);
  async function handleUnlock() {
    unlocking = true;
    try {
      const result = await unlockForSession(note);
      // unlockForSession mutates `note` in place on success and leaves
      // it untouched on cancel/wrong-password. Capturing `note` itself
      // (not just the credentials) means the later onNavigate hook
      // re-locks the right object even if `note` has since been
      // reassigned to a different loaded note.
      if (result) relockCreds = { entry: note, password: result.password, mode: result.mode };
    } finally {
      unlocking = false;
    }
  }

  // The writing surface's own theme, independent of the header bar (see
  // NoteEditorHeader.svelte / the ThemeSectionsSheet that sets
  // note.bodyTheme). Image themes are allowed here now — see
  // ThemeSectionsSheet.svelte's bodyAllowCustom comment for why that was
  // restricted before and what changed: the actual editable text
  // (.inner, below) gets its own high-opacity panel rather than sitting
  // directly on the photo, so live Tiptap caret/selection rendering is
  // never actually compositing pixel-for-pixel over an image — the
  // photo shows as a framing backdrop around the edges, not literally
  // behind the letters being typed.
  const resolvedBodyTheme = $derived(resolveTheme(note.bodyTheme, customThemes));
  // NoteContent.svelte's ruled-paper lines read var(--rule-color, <fixed
  // sepia default>) — that fixed default is a nice match for the plain
  // --surface background it was designed against, but reads as an
  // arbitrary, unrelated color once the body itself has a theme. Tie it
  // to whatever's actually behind it instead: the theme's own accent for
  // a color theme, or a light/dark-appropriate neutral (same textColor
  // decision as everywhere else) for an image — never derived from the
  // image's actual color, since .inner-panel's near-opaque backing means
  // the lines are sitting on --surface either way, not on the photo.
  const ruleColorVar = $derived(
    resolvedBodyTheme.kind === "color"
      ? `--rule-color: ${hexToRgba(resolvedBodyTheme.color, 0.4)};`
      : resolvedBodyTheme.kind === "image"
        ? `--rule-color: ${resolvedBodyTheme.textColor === "#000000" ? "rgba(0, 0, 0, 0.25)" : "rgba(255, 255, 255, 0.3)"};`
        : "",
  );
  // BUGFIX #3 (the ACTUAL shrink fix — #2's own comment on .inner below
  // explains why #2 wasn't it either): #2 correctly stopped .inner-panel
  // from adding its OWN extra padding on top of .scroll-area's, so the
  // available text WIDTH really was back to matching the non-themed
  // case — but .inner-panel was still a visually distinct, near-opaque,
  // rounded, shadowed box sitting INSET inside .scroll-area's own
  // pre-existing padding, with the photo only visible in the gap around
  // it. That reads as "the writing area shrank" even though its pixel
  // width didn't — a themed note LOOKS boxed-in/framed next to a
  // plain one, where nothing marks that same padding at all (.inner has
  // no background of its own there, so the identical gap is invisible).
  // Confirmed by re-tracing rather than re-asserting #2 already covers
  // it: todo/[id]/+page.svelte's own .inner-panel never had this
  // problem, because its wash is edge-to-edge with no separate framed
  // box — see that file's identical comment.
  // Real fix: stop treating the image case as a separate element with
  // its own background at all. Paint the same near-opaque wash straight
  // into bodyStyle's own background-image stack — same layering trick
  // headerStyle above already uses (a solid-color gradient stacked under
  // url(...) via two comma-separated background-image layers) — so it's
  // just ONE more background on .scroll-area itself, exactly like the
  // color case already is. That background naturally paints under
  // .scroll-area's own padding the same way the color wash always has,
  // so it reaches the true screen edges automatically, and there's no
  // second box left to look "framed" or "shrunk" against it — text is
  // inset by the exact same single padding every theme has always had.
  const bodyStyle = $derived(
    resolvedBodyTheme.kind === "color"
      ? `background: ${hexToRgba(resolvedBodyTheme.color, 0.14)}; ${ruleColorVar}`
      : resolvedBodyTheme.kind === "image"
        ? `background-image: linear-gradient(rgba(var(--surface-rgb), 0.93), rgba(var(--surface-rgb), 0.93)), url(${resolvedBodyTheme.dataUrl}); background-size: cover; background-position: center; background-attachment: fixed; ${ruleColorVar}`
        : "",
  );
</script>

<svelte:head>
  <title>{note.title || "Untitled"} — MidNote</title>
</svelte:head>

<main class="editor-page">
  {#if loadError}
    <div class="error-state">
      <p><strong>Something went wrong opening this note.</strong></p>
      <p class="error-detail">{loadError}</p>
      <button onclick={() => goto("/")}>Back to MidNote</button>
    </div>
  {:else}
    <NoteEditorHeader
      {note}
      availableTags={noteTags}
      onTagsChange={setTags}
      onSave={persist}
      onBack={() => goto("/")}
      {currentPageIndex}
      onSwitchPage={switchToPage}
      onAddPage={addPage}
      onDeletePage={deletePage}
      onRenamePage={renamePage}
    />

    {#if note.encrypted}
      <div class="locked-state">
        <div class="lock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
          </svg>
        </div>
        <p><strong>This note is locked.</strong></p>
        <p class="locked-detail">Unlock it to view or edit the content.</p>
        <button class="unlock-btn" onclick={handleUnlock} disabled={unlocking}>
          {#if unlocking}
            <Spinner class="unlock-spinner" />
          {/if}
          {unlocking ? "Unlocking…" : "Unlock"}
        </button>
      </div>
    {:else}
      <div class="scroll-area" style={bodyStyle}>
        <div class="inner">
          <NoteTitle bind:value={note.title} />
          {#if currentPageIndex === 0}
            <NoteContent bind:value={note.content} bind:editor bind:tick bind:hasSelection baseFontSize={fontSize.value} {syncToken} />
          {:else}
            <NoteContent bind:value={note.pages[currentPageIndex - 1].content} bind:editor bind:tick bind:hasSelection baseFontSize={fontSize.value} {syncToken} />
          {/if}
        </div>
      </div>

      <FormattingToolbar {editor} {tick} {hasSelection} />
    {/if}
  {/if}
</main>

<style>
  .editor-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 100vw;
    overflow-x: hidden;
    background: var(--bg);
  }
  .scroll-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-5) var(--space-4);
    padding-bottom: calc(52px + var(--space-4) + var(--space-5));
  }
  .inner {
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .error-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-5);
    text-align: center;
  }
  .error-state p {
    color: var(--text-hi);
    margin: 0;
  }
  .error-detail {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-lo);
  }
  .error-state button {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .locked-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-5);
    text-align: center;
  }
  .lock-icon {
    color: var(--text-faint);
    margin-bottom: var(--space-2);
  }
  .locked-state p {
    color: var(--text-hi);
    margin: 0;
  }
  .locked-detail {
    color: var(--text-lo);
    font-size: 13px;
  }
  .locked-state p.locked-detail {
    color: var(--text-lo);
  }
  .unlock-btn {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-5);
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .unlock-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* Spinner.svelte defaults to --hairline/--accent for its two arcs,
     which both read poorly against this button's solid --accent fill —
     override both to --bg (same color the button's own text already
     uses here) so it reads as one coherent white-on-accent spinner
     instead of the default two-tone look disappearing into the button.
     Plain opacity, not color-mix() — this app's target Android WebView
     (Galaxy A13) trails desktop Chromium and color-mix() isn't safe to
     assume there (same reasoning as themePalette.ts's hand-written
     hexToRgba over CSS color-mix()). */
  :global(.unlock-spinner) {
    width: 16px !important;
    height: 16px !important;
  }
  :global(.unlock-spinner circle) {
    stroke: var(--bg);
    opacity: 0.35;
  }
  :global(.unlock-spinner path) {
    stroke: var(--bg);
  }

  @media (max-width: 480px) {
    .scroll-area {
      padding-left: var(--space-3);
      padding-right: var(--space-3);
    }
  }
</style>
