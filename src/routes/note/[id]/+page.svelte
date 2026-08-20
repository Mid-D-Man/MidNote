<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, tick, untrack } from "svelte";
  import NoteEditorHeader from "$lib/components/notes/NoteEditorHeader/NoteEditorHeader.svelte";
  import NoteTitle from "$lib/components/notes/NoteTitle/NoteTitle.svelte";
  import NoteContent from "$lib/components/notes/NoteContent/NoteContent.svelte";
  import FormattingToolbar from "$lib/components/notes/FormattingToolbar/FormattingToolbar.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { noteTags, sync as syncTags } from "$lib/stores/tags.svelte";
  import { fontSize, setFontSize } from "$lib/stores/settings.svelte";
  import { createNote, getEntry } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { matchList, getLine, isSelectionWrapped, applyInlineWrap, applyListFormat, type ListType } from "$lib/utils/textEditing";
  import type { Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let loadError = $state<string | null>(null);

  // Tracked independently of textareaEl.selectionStart/End, updated on
  // every selectionchange WHILE the textarea is focused, and left alone
  // once it isn't. This is the actual fix for "formatting inserts at the
  // top of the note" — tapping a toolbar button blurs the textarea
  // before its onclick fires, and selectionStart/End reset to 0 on blur
  // on this webview, so reading them at click-time was always reading a
  // stale zero, not where the cursor actually was.
  let lastSelStart = $state(0);
  let lastSelEnd = $state(0);

  onMount(() => {
    breadcrumb(`note page mounted, id=${id}`);
    syncTags();
    load();

    // requestAnimationFrame-coalesced rather than firing on every raw
    // event — selectionchange is documented to fire very frequently on
    // some webviews (multiple times per keystroke or touch), and there's
    // no reason to write two $state values that often when once per
    // frame is plenty for tracking where the cursor is.
    let selectionRaf: number | null = null;
    const onSelectionChange = () => {
      if (selectionRaf !== null) return;
      selectionRaf = requestAnimationFrame(() => {
        selectionRaf = null;
        if (document.activeElement === textareaEl && textareaEl) {
          lastSelStart = textareaEl.selectionStart;
          lastSelEnd = textareaEl.selectionEnd;
        }
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
        return;
      }
      const existing = getEntry(id);
      if (existing && existing.type === "regular") {
        note = existing;
        resetHistory();
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

  // --- Undo/redo — unchanged from before. ---
  const HISTORY_LIMIT = 50;
  const CHECKPOINT_DELAY = 400;

  let undoStack = $state<string[]>([]);
  let redoStack = $state<string[]>([]);
  let lastCheckpoint = "";
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    // untrack is load-bearing here, not cosmetic: this function is called
    // from load(), which is called from the $effect below that also
    // WRITES `note` (via `note = createNote()` / `note = existing`).
    // Reading note.content without untrack makes `note` a dependency of
    // that same effect — an effect that both reads and writes the same
    // state re-triggers itself, which is a genuine infinite loop in
    // Svelte 5, not just a lint nitpick. Reproduced this exact shape
    // against the real Svelte runtime before and after this fix to
    // confirm: unfixed throws effect_update_depth_exceeded, fixed
    // settles after one run.
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

  // --- Formatting: uses lastSelStart/lastSelEnd (see above), not
  // textareaEl.selectionStart/End directly. ---

  const activeFormats = $derived.by(() => {
    const bold = isSelectionWrapped(note.content, lastSelStart, lastSelEnd, "**");
    const italic = isSelectionWrapped(note.content, lastSelStart, lastSelEnd, "*") && !bold;
    const underline = isSelectionWrapped(note.content, lastSelStart, lastSelEnd, "__");
    const { line } = getLine(note.content, lastSelStart);
    const list = matchList(line)?.type ?? null;
    return { bold, italic, underline, list };
  });

  async function refocusAt(pos: number, endPos = pos) {
    await tick();
    textareaEl?.focus();
    textareaEl?.setSelectionRange(pos, endPos);
    lastSelStart = pos;
    lastSelEnd = endPos;
  }

  function handleFormat(format: string) {
    const text = note.content;
    const start = lastSelStart;
    const end = lastSelEnd;

    if (format === "bold" || format === "italic" || format === "underline") {
      const marker = format === "bold" ? "**" : format === "italic" ? "*" : "__";
      const result = applyInlineWrap(text, start, end, marker);
      note.content = result.newText;
      refocusAt(result.newSelStart, result.newSelEnd);
      return;
    }

    if (format === "bulletList" || format === "orderedList" || format === "romanList") {
      const type: ListType = format === "bulletList" ? "bullet" : format === "orderedList" ? "decimal" : "roman";
      const result = applyListFormat(text, start, end, type);
      note.content = result.newText;
      refocusAt(result.newSelEnd);
      return;
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
    />

    <div class="scroll-area">
      <div class="inner">
        <NoteTitle bind:value={note.title} />
        <NoteContent bind:value={note.content} bind:textareaEl fontSize={fontSize.value} />
      </div>
    </div>

    <FormattingToolbar
      onFormat={handleFormat}
      {activeFormats}
      fontSize={fontSize.value}
      onFontSizeChange={setFontSize}
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
