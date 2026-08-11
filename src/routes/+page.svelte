<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import LoadingScreen from "$lib/components/layout/LoadingScreen/LoadingScreen.svelte";
  import AppHeader from "$lib/components/layout/AppHeader/AppHeader.svelte";
  import NoteCard from "$lib/components/notes/NoteCard/NoteCard.svelte";
  import AiNoteCreator from "$lib/components/notes/AiNoteCreator/AiNoteCreator.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import { entries, saveEntry, toggleBookmark } from "$lib/stores/entries.svelte";
  import type { Note, Todo } from "$lib/types/entry";
  import { noteTags, todoTags, sync as syncTags, registerTag, unregisterTag } from "$lib/stores/tags.svelte";
  import { createNote } from "$lib/storage";

  let isLoading = $state(true);
  let activeView = $state<"notes" | "todos">("notes");
  let selectedTag = $state<string | null>(null);
  let searchQuery = $state("");
  let sortBy = $state<"recent" | "alphabetical" | "bookmarked">("recent");

  onMount(() => {
    syncTags();
  });

  const notes = $derived(entries.filter((e): e is Note => e.type === "regular"));
  const todos = $derived(entries.filter((e): e is Todo => e.type === "todo"));

  const displayItems = $derived(activeView === "notes" ? notes : todos);
  const tagList = $derived(activeView === "notes" ? noteTags : todoTags);

  const filteredItems = $derived(
    (selectedTag ? displayItems.filter((i) => i.tags.includes(selectedTag!)) : displayItems).filter((i) => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      const haystack = i.title + " " + (i.type === "regular" ? i.content : "");
      return haystack.toLowerCase().includes(q);
    })
  );

  const sortedItems = $derived(
    [...filteredItems].sort((a, b) => {
      if (sortBy === "recent") return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      if (sortBy === "alphabetical") return a.title.localeCompare(b.title);
      return (b.isBookmarked ? 1 : 0) - (a.isBookmarked ? 1 : 0);
    })
  );

  function switchView(view: "notes" | "todos") {
    activeView = view;
    selectedTag = null;
    sortBy = "recent";
  }

  function handleClick(id: string) {
    const item = [...notes, ...todos].find((i) => i.id === id);
    goto(item?.type === "todo" ? `/todo/${id}` : `/note/${id}`);
  }

  function handleAddTag() {
    const name = prompt("Enter tag name:");
    if (name) registerTag(activeView === "notes" ? "notes" : "todos", name);
  }

  function handleRemoveTag(tag: string) {
    unregisterTag(activeView === "notes" ? "notes" : "todos", tag);
    if (selectedTag === tag) selectedTag = null;
  }

  function handleAiNoteCreated(note: { title: string; content: string }) {
    const n = createNote();
    n.title = note.title;
    n.content = note.content;
    n.tags = ["AI Generated"];
    saveEntry(n);
    registerTag("notes", "AI Generated");
  }
</script>

{#if isLoading}
  <LoadingScreen oncomplete={() => (isLoading = false)} />
{:else}
  <main class="page">
    <AppHeader />

    <div class="view-tabs">
      <button class:active={activeView === "notes"} onclick={() => switchView("notes")}>Notes</button>
      <button class:active={activeView === "todos"} onclick={() => switchView("todos")}>Todos</button>
    </div>

    <div class="content">
      <div class="inner">
        <div class="controls">
          <input
            class="search"
            type="text"
            placeholder="Search {activeView}..."
            bind:value={searchQuery}
          />
          <select class="sort" bind:value={sortBy}>
            <option value="recent">Recent</option>
            <option value="alphabetical">A-Z</option>
            <option value="bookmarked">Bookmarked</option>
          </select>
        </div>

        <div class="tags-section">
          <div class="tags-header">
            <h3>Tags</h3>
            <Button variant="outline" size="sm" onclick={handleAddTag}>Add Tag</Button>
          </div>
          <div class="tag-chips">
            {#each tagList as tag (tag)}
              <div class="chip" class:selected={selectedTag === tag}>
                <button onclick={() => (selectedTag = selectedTag === tag ? null : tag)}>{tag}</button>
                <button class="remove" onclick={() => handleRemoveTag(tag)} aria-label="Remove {tag}">×</button>
              </div>
            {/each}
          </div>
        </div>

        {#if activeView === "notes"}
          <AiNoteCreator onNoteCreated={handleAiNoteCreated} />
        {/if}

        <div class="section-header">
          <h2>{activeView === "notes" ? "All Notes" : "All Todos"}{selectedTag ? ` — ${selectedTag}` : ""}</h2>
          <Button onclick={() => goto(activeView === "notes" ? "/note/new" : "/todo/new")}>
            + New {activeView === "notes" ? "Note" : "Todo"}
          </Button>
        </div>

        {#if sortedItems.length === 0}
          <div class="empty">
            <p>No {activeView} found.</p>
            <Button size="lg" onclick={() => goto(activeView === "notes" ? "/note/new" : "/todo/new")}>
              Create {activeView === "notes" ? "Note" : "Todo"}
            </Button>
          </div>
        {:else}
          <div class="grid">
            {#each sortedItems as item (item.id)}
              {#if item.type === "regular"}
                <NoteCard note={item} onToggleBookmark={toggleBookmark} onClick={handleClick} />
              {:else}
                <button class="todo-item" onclick={() => handleClick(item.id)}>
                  <strong>{item.title || "Untitled"}</strong>
                  <span class="meta">{item.steps.length} step{item.steps.length === 1 ? "" : "s"} · {new Date(item.lastModified).toLocaleDateString()}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </main>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
  }
  .view-tabs {
    display: flex;
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
    padding: 0 var(--space-4);
    flex-shrink: 0;
  }
  .view-tabs button {
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-sans);
    font-weight: 500;
    font-size: 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-lo);
    cursor: pointer;
  }
  .view-tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5) var(--space-4);
  }
  .inner {
    max-width: 760px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .controls {
    display: flex;
    gap: var(--space-3);
  }
  .search {
    flex: 1;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .sort {
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .tags-section {
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--hairline);
  }
  .tags-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }
  .tags-header h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-hi);
    margin: 0;
  }
  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--surface-raised);
    border-radius: 999px;
    padding: 4px var(--space-1) 4px var(--space-3);
    font-size: 13px;
  }
  .chip.selected {
    background: var(--accent);
  }
  .chip.selected button {
    color: var(--bg);
  }
  .chip button {
    background: none;
    border: none;
    color: var(--text-hi);
    cursor: pointer;
    font-size: 13px;
  }
  .chip .remove {
    padding: 0 var(--space-2);
    opacity: 0.6;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .section-header h2 {
    font-family: var(--font-display);
    font-size: 19px;
    color: var(--text-hi);
    margin: 0;
  }
  .empty {
    text-align: center;
    padding: var(--space-6) 0;
  }
  .empty p {
    color: var(--text-lo);
    margin: 0 0 var(--space-4);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--space-4);
  }
  .todo-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    cursor: pointer;
    color: var(--text-hi);
  }
  .todo-item:hover {
    border-color: var(--accent-dim);
  }
  .todo-item .meta {
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
