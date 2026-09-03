<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, untrack } from "svelte";
  import NoteEditorHeader from "$lib/components/notes/NoteEditorHeader/NoteEditorHeader.svelte";
  import NoteTitle from "$lib/components/notes/NoteTitle/NoteTitle.svelte";
  import NoteContent from "$lib/components/notes/NoteContent/NoteContent.svelte";
  import FormattingToolbar from "$lib/components/notes/FormattingToolbar/FormattingToolbar.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { noteTags, sync as syncTags } from "$lib/stores/tags.svelte";
  import { fontSize } from "$lib/stores/settings.svelte";
  import { createNote, getEntry } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import {
    applyInlineFormat,
    escapeInlineFormattingContext,
    queryActiveFormats,
    applyListFormat,
    queryActiveList,
    applyValueStyleToSelection,
    clearValueStyleFromSelection,
    applyValueStyleToCapturedRange,
    clearValueStyleFromCapturedRange,
    getCurrentFontSize,
    getCurrentColor,
    getCurrentBackgroundColor,
    readSelectionState,
    emptyPendingFormats,
    stripHtml,
    type InlineFormat,
    type ListKind,
    type PendingFormats,
  } from "$lib/utils/richText";
  import type { Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let contentEl = $state<HTMLDivElement | null>(null);
  let loadError = $state<string | null>(null);

  // Tells NoteContent when to push `note.content` INTO the DOM —
  // bumped on note load, undo, and redo (see the REVISION NOTE in
  // NoteContent.svelte). NOT bumped anywhere content is read OUT of
  // the DOM (syncContentFromDom, oninput/onpaste) — those are one-
  // directional and must stay that way, or this recreates the exact
  // bind:innerHTML round-trip bug this pairing of changes fixes.
  let domSyncToken = $state(0);

  // Live formatting/selection state for the toolbar — read straight from
  // the DOM Selection API, not derived from note.content. The Selection
  // API isn't something Svelte's reactivity tracks, so this is plain
  // $state, imperatively refreshed on selectionchange (RAF-coalesced)
  // and right after applying a command. None of the refresh call sites
  // below are inside an $effect (onMount setup, a DOM event listener,
  // plain onclick-driven functions) — see docs/svelte5-effect-safety.md.
  let hasSelection = $state(false);
  // True for exactly as long as either format popup is open (the
  // header's Actions sheet for no-selection, FormattingToolbar's style
  // sheet for has-selection) — wired from each via
  // onFormatPickerOpenChange. See its use in refreshFormatState's
  // `!state.within` branch below for why this exists: tapping a control
  // inside either sheet can take focus away from the note body's
  // contenteditable (ordinary browser behavior for a <button> or a
  // native <input type=range>, not something worth fighting with
  // preventDefault — see FormatValuePicker.svelte's header comment for
  // why that approach broke the font-size slider's own native dragging).
  // Rather than stopping focus from moving, this just tells
  // refreshFormatState that a selection/focus change happening *because
  // one of these is open* isn't the user navigating away and shouldn't
  // wipe pendingFormats — the actual thing that was going wrong.
  let formatPickerOpen = $state(false);
  let activeFormats = $state({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    list: null as ListKind | null,
    color: null as string | null,
    backgroundColor: null as string | null,
  });
  let currentFontSize = $state(fontSize.value);

  // Bold/italic/underline/strikethrough/fontSize/color/backgroundColor
  // toggled on with NO selection — i.e. "apply this to whatever gets
  // typed next." Explicit, page-owned state, fully reset on every note
  // load. NOT the same thing as execCommand's own built-in "sticky
  // typing style" tracking, deliberately — see richText.ts's header
  // comment for the on-device bug that caused the switch: that
  // browser-internal state couldn't reliably be toggled back off, and
  // leaked between notes because this is an SPA (no full page reload
  // between them, so nothing was ever forcing it to clear).
  let pendingFormats = $state<PendingFormats>(emptyPendingFormats());
  // The caret position our own last auto-format wrap left things in —
  // lets refreshFormatState tell "the selection changed because I just
  // wrapped a typed character" apart from "the selection changed because
  // the user tapped or arrow-keyed somewhere else," and only reset
  // pendingFormats for the latter.
  let lastAutoFormatPos: { node: Node; offset: number } | null = null;
  // Updated on every refreshFormatState run, not just after an
  // auto-format wrap — a plain "where was the caret last time we
  // checked" tracker, distinct from lastAutoFormatPos's narrower "did
  // my own wrap just move it here" purpose. Exists to recognize a
  // selectionchange that reports the exact same collapsed position as
  // last time as redundant/spurious — the caret didn't actually move,
  // so there's no reason to treat it as "the user navigated away" and
  // reset pendingFormats. isEcho alone can't catch this: it's scoped to
  // positions this file's own auto-format wrap just produced, and stays
  // null the entire window between "toggle a pending format" and
  // "type the first character" — exactly the window a stray
  // selectionchange (nothing observed to move the caret, but one fires
  // anyway) would wipe the just-toggled format in, with no way to tell
  // it apart from a real navigation. This is a general fix for that gap,
  // not specific to any one format.

  // Snapshot of the selection Range taken the instant the font-size/
  // color/backgroundColor <select> is pressed — see
  // applyValueStyleToCapturedRange's comment in richText.ts for why.
  // Plain (non-reactive) variable: a Range isn't meaningful $state, it's
  // a one-shot handoff between "control pressed" and "value picked,"
  // consumed and nulled out the moment it's used.
  //
  // REVISION: previously took a "color" | "bgColor" panel argument, back
  // when there were separate custom panels for each. The toolbar no
  // longer has panels at all (see FormattingToolbar.svelte) — every
  // control that can disturb the selection now goes through this same
  // one function, so the argument had nothing left to distinguish.
  // Also now covers font size, which shares applyValueStyleToSelection's
  // underlying span-wrap mechanism with color/backgroundColor and was
  // never actually protected before — an oversight in the original
  // captured-range pass, not something new about this WebView.
  let capturedFormatRange: Range | null = null;
  let lastKnownCaretPos: { node: Node; offset: number } | null = null;

  function captureFormatRange() {
    if (!hasSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    capturedFormatRange = sel.getRangeAt(0).cloneRange();
  }

  function resetPendingFormats() {
    pendingFormats = emptyPendingFormats();
  }

  function resetFormatState() {
    hasSelection = false;
    activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, list: null, color: null, backgroundColor: null };
    currentFontSize = fontSize.value;
    resetPendingFormats();
    lastAutoFormatPos = null;
    lastKnownCaretPos = null;
    capturedFormatRange = null;
  }

  function refreshFormatState() {
    if (!contentEl) {
      resetFormatState();
      return;
    }
    // A tap or drag inside either format popup can move focus/selection
    // away from the note body — ordinary behavior for a <button> or a
    // native <input type=range>, not a bug to route around with
    // preventDefault (see formatPickerOpen's own comment above). Freeze
    // everything format-related for as long as one is open rather than
    // reacting to what's really our own UI, not the user navigating
    // away: hasSelection included, so the toolbar's selection-mode
    // layout doesn't switch out from under an open popup either. Whatever
    // selectionchange fires once the picker actually closes picks this
    // back up normally.
    if (formatPickerOpen) return;
    const state = readSelectionState(contentEl);
    hasSelection = state.hasSelection;

    if (!state.within) {
      activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, list: null, color: null, backgroundColor: null };
      currentFontSize = fontSize.value;
      resetPendingFormats();
      lastAutoFormatPos = null;
      lastKnownCaretPos = null;
      return;
    }

    currentFontSize = getCurrentFontSize(contentEl, fontSize.value);

    if (hasSelection) {
      activeFormats = {
        ...queryActiveFormats(),
        list: queryActiveList(contentEl),
        color: getCurrentColor(contentEl),
        backgroundColor: getCurrentBackgroundColor(contentEl),
      };
      resetPendingFormats();
      lastAutoFormatPos = null;
      lastKnownCaretPos = null;
      return;
    }

    // Collapsed caret: the toolbar reflects OUR pending state here, not
    // whatever the DOM/queryCommandState happens to say at this exact
    // point — see the pendingFormats comment above for why.
    activeFormats = { ...pendingFormats, list: queryActiveList(contentEl) };
    const sel = window.getSelection();
    const node = sel?.anchorNode ?? null;
    const offset = sel?.anchorOffset ?? -1;
    const isEcho = !!lastAutoFormatPos && node === lastAutoFormatPos.node && offset === lastAutoFormatPos.offset;
    const isSpuriousRepeat = !!lastKnownCaretPos && node === lastKnownCaretPos.node && offset === lastKnownCaretPos.offset;
    if (!isEcho && !isSpuriousRepeat) resetPendingFormats();
    lastAutoFormatPos = null;
    lastKnownCaretPos = node ? { node, offset } : null;
  }

  function handleAutoFormatApplied(node: Node, offset: number) {
    lastAutoFormatPos = { node, offset };
  }

  onMount(() => {
    breadcrumb(`note page mounted, id=${id}`);
    syncTags();
    load();

    let selectionRaf: number | null = null;
    const onSelectionChange = () => {
      if (selectionRaf !== null) return;
      selectionRaf = requestAnimationFrame(() => {
        selectionRaf = null;
        refreshFormatState();
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);

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
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("visibilitychange", saveIfHidden);
      window.removeEventListener("pagehide", saveOnPagehide);
      if (selectionRaf !== null) cancelAnimationFrame(selectionRaf);
    };
  });

  $effect(() => {
    breadcrumb(`note page effect: id=${id}`);
    load();
  });

  function load() {
    try {
      loadError = null;
      if (!id || id === "new") {
        note = createNote();
        domSyncToken = untrack(() => domSyncToken) + 1;
        resetHistory();
        resetFormatState();
        return;
      }
      const existing = getEntry(id);
      if (existing && existing.type === "regular") {
        note = existing;
        domSyncToken = untrack(() => domSyncToken) + 1;
        resetHistory();
        resetFormatState();
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
    // note.content's default is "<div><br></div>" now, not "" (see
    // storage.ts) — stripHtml it before checking emptiness, or a
    // never-touched new note would look non-empty and get saved anyway.
    if (!note.title.trim() && !stripHtml(note.content)) return;
    saveEntry(note);
  }

  function setTags(tags: string[]) {
    note.tags = tags;
    persist();
  }

  // --- Undo/redo — unchanged mechanism from before. ---
  const HISTORY_LIMIT = 50;
  const CHECKPOINT_DELAY = 400;

  let undoStack = $state<string[]>([]);
  let redoStack = $state<string[]>([]);
  let lastCheckpoint = "";
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    lastCheckpoint = untrack(() => note.content);
    clearTimeout(checkpointTimer);
  }

  $effect(() => {
    note.content; // track
    clearTimeout(checkpointTimer);
    checkpointTimer = setTimeout(() => {
      if (note.content !== lastCheckpoint) {
        undoStack.push(lastCheckpoint);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack = [];
        lastCheckpoint = note.content;
      }
    }, CHECKPOINT_DELAY);
  });

  const canUndo = $derived(undoStack.length > 0);
  const canRedo = $derived(redoStack.length > 0);

  function undo() {
    if (undoStack.length === 0) return;
    clearTimeout(checkpointTimer);
    redoStack.push(note.content);
    note.content = undoStack.pop()!;
    domSyncToken = untrack(() => domSyncToken) + 1;
    lastCheckpoint = note.content;
  }

  function redo() {
    if (redoStack.length === 0) return;
    clearTimeout(checkpointTimer);
    undoStack.push(note.content);
    note.content = redoStack.pop()!;
    domSyncToken = untrack(() => domSyncToken) + 1;
    lastCheckpoint = note.content;
  }

  // --- Formatting ---

  function syncContentFromDom() {
    if (contentEl) note.content = contentEl.innerHTML;
  }

  const INLINE_FORMATS = new Set(["bold", "italic", "underline", "strikethrough"]);
  const LIST_FORMATS: Record<string, ListKind> = {
    bulletList: "bullet",
    orderedList: "decimal",
    romanList: "roman",
  };

  function handleFormat(format: string) {
    if (!contentEl) return;

    if (INLINE_FORMATS.has(format)) {
      if (hasSelection) {
        contentEl.focus();
        applyInlineFormat(format as InlineFormat, contentEl);
        refreshFormatState();
        syncContentFromDom();
      } else {
        // Mostly just our own boolean flip — see the pendingFormats
        // comment above for why this doesn't touch execCommand at all
        // while toggling. The one exception: toggling OFF specifically
        // also escapes the caret out of any formatting element it's
        // currently sitting inside (e.g. the span wrapLastInsertedText
        // created for the last character typed while this was pending —
        // see richText.ts). Nothing else walks it back out on a bare
        // toggle, so without this the very next keystroke lands inside
        // that same span regardless of pendingFormats now reading
        // false — structurally continuing a format the user just turned
        // off. Safe to call unconditionally on toggle-off: it's a no-op
        // if the caret isn't inside any formatting element (e.g. this
        // format was toggled on and off again without ever actually
        // being typed).
        const key = format as keyof Pick<PendingFormats, "bold" | "italic" | "underline" | "strikethrough">;
        const nextValue = !pendingFormats[key];
        pendingFormats = { ...pendingFormats, [key]: nextValue };
        activeFormats = { ...activeFormats, [key]: nextValue };
        if (!nextValue) escapeInlineFormattingContext(contentEl);
      }
      return;
    }

    if (format in LIST_FORMATS) {
      contentEl.focus();
      applyListFormat(LIST_FORMATS[format], contentEl);
      refreshFormatState();
      syncContentFromDom();
    }
  }

  function handleFontSizeChange(size: number) {
    if (!contentEl) return;
    if (capturedFormatRange) {
      const range = capturedFormatRange;
      capturedFormatRange = null;
      try {
        contentEl.focus();
        applyValueStyleToCapturedRange(range, contentEl, { fontSize: size });
        refreshFormatState();
        syncContentFromDom();
        return;
      } catch (err) {
        console.error("note page: captured-range fontSize apply failed, falling back to live selection:", err);
      }
    }
    if (hasSelection) {
      contentEl.focus();
      applyValueStyleToSelection(contentEl, { fontSize: size });
      refreshFormatState();
      syncContentFromDom();
    } else {
      pendingFormats = { ...pendingFormats, fontSize: size };
      currentFontSize = size;
    }
  }

  function handleColorChange(color: string | null) {
    if (!contentEl) return;
    if (capturedFormatRange) {
      const range = capturedFormatRange;
      capturedFormatRange = null;
      try {
        contentEl.focus();
        if (color) applyValueStyleToCapturedRange(range, contentEl, { color });
        else clearValueStyleFromCapturedRange(range, contentEl, ["color"]);
        refreshFormatState();
        syncContentFromDom();
        return;
      } catch (err) {
        // Range methods can throw if the captured range's nodes somehow
        // stopped being attached to the document in the gap since
        // capture — not expected (nothing edits note content while a
        // panel is open), but falling through to the live-selection
        // path below is safer than surfacing this as a hard failure.
        console.error("note page: captured-range color apply failed, falling back to live selection:", err);
      }
    }
    if (hasSelection) {
      contentEl.focus();
      if (color) applyValueStyleToSelection(contentEl, { color });
      else clearValueStyleFromSelection(contentEl, ["color"]);
      refreshFormatState();
      syncContentFromDom();
    } else {
      pendingFormats = { ...pendingFormats, color };
      activeFormats = { ...activeFormats, color };
    }
  }

  function handleBackgroundColorChange(color: string | null) {
    if (!contentEl) return;
    if (capturedFormatRange) {
      const range = capturedFormatRange;
      capturedFormatRange = null;
      try {
        contentEl.focus();
        if (color) applyValueStyleToCapturedRange(range, contentEl, { backgroundColor: color });
        else clearValueStyleFromCapturedRange(range, contentEl, ["backgroundColor"]);
        refreshFormatState();
        syncContentFromDom();
        return;
      } catch (err) {
        console.error("note page: captured-range backgroundColor apply failed, falling back to live selection:", err);
      }
    }
    if (hasSelection) {
      contentEl.focus();
      if (color) applyValueStyleToSelection(contentEl, { backgroundColor: color });
      else clearValueStyleFromSelection(contentEl, ["backgroundColor"]);
      refreshFormatState();
      syncContentFromDom();
    } else {
      pendingFormats = { ...pendingFormats, backgroundColor: color };
      activeFormats = { ...activeFormats, backgroundColor: color };
    }
  }
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
      {hasSelection}
      {activeFormats}
      onFormat={handleFormat}
      fontSize={currentFontSize}
      onFontSizeChange={handleFontSizeChange}
      onColorChange={handleColorChange}
      onBackgroundColorChange={handleBackgroundColorChange}
      onFormatPickerOpenChange={(open) => (formatPickerOpen = open)}
    />

    <div class="scroll-area">
      <div class="inner">
        <NoteTitle bind:value={note.title} />
        <NoteContent
          bind:value={note.content}
          bind:contentEl
          baseFontSize={fontSize.value}
          {pendingFormats}
          syncToken={domSyncToken}
          onAutoFormatApplied={handleAutoFormatApplied}
          {hasSelection}
        />
      </div>
    </div>

    <FormattingToolbar
      onFormat={handleFormat}
      {activeFormats}
      {hasSelection}
      fontSize={currentFontSize}
      onFontSizeChange={handleFontSizeChange}
      onColorChange={handleColorChange}
      onBackgroundColorChange={handleBackgroundColorChange}
      onCaptureRange={captureFormatRange}
      onFormatPickerOpenChange={(open) => (formatPickerOpen = open)}
      {canUndo}
      {canRedo}
      onUndo={undo}
      onRedo={redo}
    />
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

  @media (max-width: 480px) {
    .scroll-area {
      padding-left: var(--space-3);
      padding-right: var(--space-3);
    }
  }
</style>
