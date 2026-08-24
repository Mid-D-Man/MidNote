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
    queryActiveFormats,
    applyListFormat,
    queryActiveList,
    applyFontSize,
    getCurrentFontSize,
    readSelectionState,
    type InlineFormat,
    type ListKind,
  } from "$lib/utils/richText";
  import type { Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let contentEl = $state<HTMLDivElement | null>(null);
  let loadError = $state<string | null>(null);

  // Live formatting/selection state for the toolbar — read straight from
  // the DOM Selection API, not derived from note.content. The Selection
  // API isn't something Svelte's reactivity tracks, so unlike the old
  // textarea-offset version this can't be a $derived — it's plain
  // $state, imperatively refreshed on selectionchange (RAF-coalesced,
  // same pattern as the old lastSelStart/lastSelEnd tracking used) and
  // right after applying a command. None of the refresh call sites below
  // are inside an $effect (onMount setup, a DOM event listener, plain
  // onclick-driven functions) — see docs/svelte5-effect-safety.md. This
  // sidesteps that bug class by construction rather than by care.
  let hasSelection = $state(false);
  let activeFormats = $state({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    list: null as ListKind | null,
  });
  let currentFontSize = $state(fontSize.value);

  function resetFormatState() {
    hasSelection = false;
    activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, list: null };
    currentFontSize = fontSize.value;
  }

  function refreshFormatState() {
    if (!contentEl) {
      resetFormatState();
      return;
    }
    const state = readSelectionState(contentEl);
    hasSelection = state.hasSelection;
    if (!state.within) {
      activeFormats = { bold: false, italic: false, underline: false, strikethrough: false, list: null };
      currentFontSize = fontSize.value;
      return;
    }
    activeFormats = { ...queryActiveFormats(), list: queryActiveList(contentEl) };
    currentFontSize = getCurrentFontSize(contentEl, fontSize.value);
  }

  onMount(() => {
    breadcrumb(`note page mounted, id=${id}`);
    syncTags();
    load();

    // requestAnimationFrame-coalesced rather than firing on every raw
    // event — selectionchange is documented to fire very frequently on
    // some webviews (multiple times per keystroke or touch), and there's
    // no reason to refresh formatting state that often when once per
    // frame is plenty for tracking where the cursor/selection is.
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
        resetHistory();
        resetFormatState();
        return;
      }
      const existing = getEntry(id);
      if (existing && existing.type === "regular") {
        note = existing;
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
    if (!note.title.trim() && !note.content.trim()) return;
    saveEntry(note);
  }

  function setTags(tags: string[]) {
    note.tags = tags;
    persist();
  }

  // --- Undo/redo — unchanged mechanism from before. note.content is an
  // HTML string now instead of plain text, but this just snapshots and
  // restores whatever string it currently is, so nothing else here
  // needed to change. ---
  const HISTORY_LIMIT = 50;
  const CHECKPOINT_DELAY = 400;

  let undoStack = $state<string[]>([]);
  let redoStack = $state<string[]>([]);
  let lastCheckpoint = "";
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    // untrack is load-bearing here, not cosmetic — this function is called
    // from load(), which is called from the $effect above that also
    // WRITES `note` (via `note = createNote()` / `note = existing`).
    // Reading note.content without untrack makes `note` a dependency of
    // that same effect — an effect that both reads and writes the same
    // state re-triggers itself, a genuine infinite loop in Svelte 5. See
    // docs/svelte5-effect-safety.md for the full incident writeup.
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
    lastCheckpoint = note.content;
  }

  function redo() {
    if (redoStack.length === 0) return;
    clearTimeout(checkpointTimer);
    undoStack.push(note.content);
    note.content = redoStack.pop()!;
    lastCheckpoint = note.content;
  }

  // --- Formatting: acts on the live contenteditable DOM/Selection
  // directly via execCommand (richText.ts), not on note.content string
  // offsets — that's what makes "applies to the selection if there is
  // one, otherwise sets sticky state for whatever's typed next" work
  // without hand-rolling either half of it. ---

  function syncContentFromDom() {
    // execCommand mutates the DOM directly. Modern webviews fire a
    // native `input` event afterward, which NoteContent's bind:innerHTML
    // would pick up on its own — but relying on that alone, unverified,
    // on this specific WebView is exactly the kind of assumption this
    // project has been burned by before. Setting it explicitly here
    // costs nothing and removes the assumption.
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
    // Defensive backstop, not the actual fix — the toolbar's
    // mousedown.preventDefault() is what actually keeps contentEl
    // focused (and its Selection live) when a button is tapped. Calling
    // .focus() on an element that's already focused is a harmless no-op.
    contentEl.focus();

    if (INLINE_FORMATS.has(format)) {
      applyInlineFormat(format as InlineFormat);
    } else if (format in LIST_FORMATS) {
      applyListFormat(LIST_FORMATS[format], contentEl);
    } else {
      return;
    }

    refreshFormatState();
    syncContentFromDom();
  }

  function handleFontSizeChange(size: number) {
    if (!contentEl) return;
    contentEl.focus();
    applyFontSize(contentEl, size);
    refreshFormatState();
    syncContentFromDom();
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
    />

    <div class="scroll-area">
      <div class="inner">
        <NoteTitle bind:value={note.title} />
        <NoteContent bind:value={note.content} bind:contentEl baseFontSize={fontSize.value} />
      </div>
    </div>

    <FormattingToolbar
      onFormat={handleFormat}
      {activeFormats}
      {hasSelection}
      fontSize={currentFontSize}
      onFontSizeChange={handleFontSizeChange}
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
