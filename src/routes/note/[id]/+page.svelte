<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import NoteEditorHeader from "$lib/components/notes/NoteEditorHeader/NoteEditorHeader.svelte";
  import NoteTitle from "$lib/components/notes/NoteTitle/NoteTitle.svelte";
  import NoteContent from "$lib/components/notes/NoteContent/NoteContent.svelte";
  import FormattingToolbar from "$lib/components/notes/FormattingToolbar/FormattingToolbar.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { noteTags, sync as syncTags } from "$lib/stores/tags.svelte";
  import { createNote, getEntry } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let loadError = $state<string | null>(null);

  onMount(() => {
    breadcrumb(`note page mounted, id=${id}`);
    syncTags();
    load();

    // Auto-save "on quit" — visibilitychange fires when the app is
    // backgrounded/switched away from/the phone is locked, which covers
    // the mobile "quit" cases a plain route-change save wouldn't (home
    // button, task switcher, incoming call). pagehide is the fallback for
    // the cases visibilitychange doesn't reliably cover on some Android
    // webviews.
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

  // --- Undo/redo — content only (see NoteEditorHeader), limited to a
  // capped history of checkpoints rather than per-keystroke, so a burst
  // of typing is one undo step, not fifty. ---
  const HISTORY_LIMIT = 50;
  const CHECKPOINT_DELAY = 400;

  let undoStack = $state<string[]>([]);
  let redoStack = $state<string[]>([]);
  let lastCheckpoint = "";
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    lastCheckpoint = note.content;
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

  // Real markdown insertion at the current selection — see
  // FormattingToolbar's header comment for why this replaces the
  // original's non-functional execCommand wiring.
  function handleFormat(format: string) {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    const selected = note.content.slice(start, end);

    const wrap = (marker: string) => {
      note.content = note.content.slice(0, start) + marker + selected + marker + note.content.slice(end);
    };
    const prefixLines = (prefix: (i: number) => string) => {
      const lines = (selected || "").split("\n");
      const replaced = lines.map((line, i) => prefix(i) + line).join("\n");
      note.content = note.content.slice(0, start) + replaced + note.content.slice(end);
    };

    switch (format) {
      case "bold":
        wrap("**");
        break;
      case "italic":
        wrap("*");
        break;
      case "underline":
        wrap("__");
        break;
      case "bulletList":
        prefixLines(() => "- ");
        break;
      case "orderedList":
        prefixLines((i) => `${i + 1}. `);
        break;
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
      {canUndo}
      {canRedo}
      onUndo={undo}
      onRedo={redo}
    />

    <div class="scroll-area">
      <div class="inner">
        <NoteTitle bind:value={note.title} />
        <NoteContent bind:value={note.content} bind:textareaEl />
      </div>
    </div>

    <FormattingToolbar onFormat={handleFormat} />
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
    /* Reserve room below the last line for the floating toolbar (52px
       bar + its own bottom offset + breathing room) so it can never
       sit on top of text being typed. */
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
