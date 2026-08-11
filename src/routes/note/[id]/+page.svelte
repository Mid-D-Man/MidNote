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
  import type { Note } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let note = $state<Note>(createNote());
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  onMount(() => {
    syncTags();
    load();
  });

  $effect(() => {
    id; // re-run when navigating between notes directly
    load();
  });

  function load() {
    if (!id || id === "new") {
      note = createNote();
      return;
    }
    const existing = getEntry(id);
    if (existing && existing.type === "regular") {
      note = existing;
    } else {
      goto("/");
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
      <NoteContent bind:value={note.content} bind:textareaEl />
    </div>
  </div>

  <FormattingToolbar onFormat={handleFormat} />
</main>

<style>
  .editor-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }
  .scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5) var(--space-4);
  }
  .inner {
    max-width: 680px;
    margin: 0 auto;
  }
</style>
