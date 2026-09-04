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
  import { goto } from "$app/navigation";
  import { onMount, untrack } from "svelte";
  import type { Editor } from "@tiptap/core";
  import NoteEditorHeader from "$lib/components/notes/NoteEditorHeader/NoteEditorHeader.svelte";
  import NoteTitle from "$lib/components/notes/NoteTitle/NoteTitle.svelte";
  import NoteContent from "$lib/components/notes/NoteContent/NoteContent.svelte";
  import FormattingToolbar from "$lib/components/notes/FormattingToolbar/FormattingToolbar.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { noteTags, sync as syncTags } from "$lib/stores/tags.svelte";
  import { fontSize } from "$lib/stores/settings.svelte";
  import { createNote, getEntry } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { stripHtml } from "$lib/utils/richText";
  import type { Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let loadError = $state<string | null>(null);

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

  $effect(() => {
    breadcrumb(`note page effect: id=${id}`);
    load();
  });

  function load() {
    try {
      loadError = null;
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
    if (!note.title.trim() && !stripHtml(note.content)) return;
    saveEntry(note);
  }

  function setTags(tags: string[]) {
    note.tags = tags;
    persist();
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
    <NoteEditorHeader {note} availableTags={noteTags} onTagsChange={setTags} onSave={persist} onBack={() => goto("/")} />

    <div class="scroll-area">
      <div class="inner">
        <NoteTitle bind:value={note.title} />
        <NoteContent bind:value={note.content} bind:editor bind:tick bind:hasSelection baseFontSize={fontSize.value} {syncToken} />
      </div>
    </div>

    <FormattingToolbar {editor} {tick} {hasSelection} />
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
