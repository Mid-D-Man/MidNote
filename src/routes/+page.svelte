<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import LoadingScreen from "$lib/components/layout/LoadingScreen/LoadingScreen.svelte";
  import AppHeader from "$lib/components/layout/AppHeader/AppHeader.svelte";
  import NoteCard from "$lib/components/notes/NoteCard/NoteCard.svelte";
  import AiNoteCreator from "$lib/components/notes/AiNoteCreator/AiNoteCreator.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import SelectionActionBar from "$lib/components/shared/SelectionActionBar/SelectionActionBar.svelte";
  import CardOverflowMenu from "$lib/components/shared/CardOverflowMenu/CardOverflowMenu.svelte";
  import { entries, saveEntry, removeEntry, toggleBookmark, toggleStrikethrough } from "$lib/stores/entries.svelte";
  import type { Note, Todo, Entry } from "$lib/types/entry";
  import { noteTags, todoTags, sync as syncTags, registerTag, unregisterTag } from "$lib/stores/tags.svelte";
  import { createNote } from "$lib/storage";
  import { stripHtml, plainTextToHtml } from "$lib/utils/richText";
  import { createLongPressHandlers } from "$lib/utils/longPress";
  import { mergeNotes, mergeTodos, buildExportFiles, downloadFiles, type ExportFormat } from "$lib/utils/selectionActions";
  import { shareFiles } from "$lib/utils/share";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let isLoading = $state(true);
  let activeView = $state<"notes" | "todos">("notes");
  let selectedTag = $state<string | null>(null);
  let searchQuery = $state("");
  let sortBy = $state<"recent" | "alphabetical" | "bookmarked">("recent");

  // Long-press multi-select — see NoteCard.svelte / SelectionActionBar.svelte.
  // Scoped to whichever list (notes or todos) is currently showing:
  // switching tabs while items are selected would leave the action bar
  // showing a selection that's no longer even visible, so it clears.
  let selectMode = $state(false);
  let selectedIds = $state<Set<string>>(new Set());
  let showMergeConfirm = $state(false);
  let pendingMerge = $state<{ merged: Entry; sourceIds: string[] } | null>(null);

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
      // note.content is HTML now (see NoteContent.svelte) — strip tags
      // before searching, or e.g. searching "strong" would false-match
      // every bolded note.
      const haystack = i.title + " " + (i.type === "regular" ? stripHtml(i.content) : "");
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

  const selectedEntries = $derived(entries.filter((e) => selectedIds.has(e.id)));
  const canMerge = $derived(selectedIds.size >= 2);

  function switchView(view: "notes" | "todos") {
    activeView = view;
    selectedTag = null;
    sortBy = "recent";
    exitSelectMode();
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
    // note.content is stored as HTML now (see NoteContent.svelte) — the
    // AI creator hands back plain text, so it needs escaping rather
    // than being written straight in, or a "<" in the generated text
    // would get parsed as a tag instead of displayed literally.
    n.content = plainTextToHtml(note.content);
    n.tags = ["AI Generated"];
    saveEntry(n);
    registerTag("notes", "AI Generated");
  }

  // --- Multi-select ---

  function enterSelectMode(id: string) {
    breadcrumb(`selection: entered select mode via long-press on ${id}`);
    selectMode = true;
    selectedIds = new Set([id]);
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  function exitSelectMode() {
    selectMode = false;
    selectedIds = new Set();
  }

  function handleDeleteSelected() {
    const count = selectedIds.size;
    selectedIds.forEach((id) => removeEntry(id));
    pushToast({ title: `${count} ${activeView === "notes" ? "note" : "todo"}${count === 1 ? "" : "s"} deleted`, variant: "destructive" });
    exitSelectMode();
  }

  // Per-card ⋮ menu actions — outside multi-select entirely, one item
  // at a time. Shared between notes and todos (both are just Entry
  // here), matching the shared CardOverflowMenu component itself.
  function handleDeleteSingle(id: string) {
    const item = entries.find((e) => e.id === id);
    removeEntry(id);
    pushToast({ title: `${item?.type === "todo" ? "Todo" : "Note"} deleted`, variant: "destructive" });
  }

  function handleDownloadSingle(id: string) {
    const item = entries.find((e) => e.id === id);
    if (!item) return;
    downloadFiles(buildExportFiles([item], "separate"));
    pushToast({ title: "Downloaded" });
  }

  async function handleSendSelected() {
    const files = buildExportFiles(selectedEntries, "separate");
    const title = files.length === 1 ? files[0].name : `${files.length} items from MidNote`;
    const result = await shareFiles(files, { title });
    if (result === "shared") {
      pushToast({ title: "Shared" });
      exitSelectMode();
    } else if (result === "cancelled") {
      // User dismissed the native share sheet — a normal, silent outcome.
    } else {
      // Not supported (or a genuine error) on this WebView — fall back
      // to a download so the action still does something useful rather
      // than a dead end. Real platform uncertainty, not a guess dressed
      // up as one — see share.ts's header comment.
      downloadFiles(files);
      pushToast({ title: "Sharing isn't available here", description: "Downloaded instead." });
      exitSelectMode();
    }
  }

  function handleMergeSelected() {
    if (!canMerge) return;
    breadcrumb(`selection: merging ${selectedIds.size} ${activeView}`);
    const sourceIds = [...selectedIds];
    if (activeView === "notes") {
      const merged = mergeNotes(selectedEntries as Note[]);
      pendingMerge = { merged, sourceIds };
    } else {
      const merged = mergeTodos(selectedEntries as Todo[]);
      pendingMerge = { merged, sourceIds };
    }
    saveEntry(pendingMerge.merged);
    showMergeConfirm = true;
  }

  function confirmDeleteMergeSources() {
    if (!pendingMerge) return;
    pendingMerge.sourceIds.forEach((id) => removeEntry(id));
    pushToast({ title: "Merged", description: `${pendingMerge.sourceIds.length} originals removed.` });
    goToMergedAndReset();
  }

  function keepMergeSources() {
    pushToast({ title: "Merged", description: "Originals kept as-is." });
    goToMergedAndReset();
  }

  function goToMergedAndReset() {
    const merged = pendingMerge?.merged;
    exitSelectMode();
    pendingMerge = null;
    if (merged) goto(merged.type === "todo" ? `/todo/${merged.id}` : `/note/${merged.id}`);
  }

  function handleExportSelected(format: ExportFormat) {
    breadcrumb(`selection: exporting ${selectedIds.size} items as ${format}`);
    downloadFiles(buildExportFiles(selectedEntries, format));
    pushToast({ title: "Exported", description: `${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} downloaded.` });
    exitSelectMode();
  }

  // Todos don't have a dedicated card component (see the inline markup
  // below) — same long-press-vs-tap gesture, reimplemented here rather
  // than pulled into a shared component, since the todo item's markup
  // is simple enough that a whole extra component would be more
  // indirection than the few lines it'd save.
  let suppressTodoClick = new Set<string>();

  function todoPressHandlers(id: string) {
    return createLongPressHandlers({
      onLongPress: () => {
        suppressTodoClick.add(id);
        enterSelectMode(id);
      },
      onTap: () => {
        suppressTodoClick.add(id);
        if (selectMode) toggleSelect(id);
        else handleClick(id);
      },
    });
  }

  function handleTodoClick(id: string) {
    if (suppressTodoClick.has(id)) {
      suppressTodoClick.delete(id);
      return;
    }
    if (selectMode) toggleSelect(id);
    else handleClick(id);
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

    <div class="content" class:with-bar={selectMode}>
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

        {#if activeView === "notes" && !selectMode}
          <AiNoteCreator onNoteCreated={handleAiNoteCreated} />
        {/if}

        <div class="section-header">
          <h2>{activeView === "notes" ? "All Notes" : "All Todos"}{selectedTag ? ` — ${selectedTag}` : ""}</h2>
          {#if !selectMode}
            <Button onclick={() => goto(activeView === "notes" ? "/note/new" : "/todo/new")}>
              + New {activeView === "notes" ? "Note" : "Todo"}
            </Button>
          {/if}
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
                <NoteCard
                  note={item}
                  onToggleBookmark={toggleBookmark}
                  onClick={handleClick}
                  selectionMode={selectMode}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                  onEnterSelectMode={enterSelectMode}
                  onDelete={handleDeleteSingle}
                  onDownload={handleDownloadSingle}
                  onToggleStrikethrough={toggleStrikethrough}
                />
              {:else}
                <div
                  class="todo-item"
                  class:selected={selectedIds.has(item.id)}
                  role="button"
                  tabindex="0"
                  onclick={() => handleTodoClick(item.id)}
                  onkeydown={(e) => e.key === "Enter" && handleTodoClick(item.id)}
                  {...todoPressHandlers(item.id)}
                >
                  {#if selectMode}
                    <div class="select-check" class:checked={selectedIds.has(item.id)} aria-hidden="true">
                      {#if selectedIds.has(item.id)}
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      {/if}
                    </div>
                  {:else}
                    <div class="todo-overflow">
                      <CardOverflowMenu
                        itemLabel="todo"
                        struck={item.struck}
                        onDelete={() => handleDeleteSingle(item.id)}
                        onDownload={() => handleDownloadSingle(item.id)}
                        onToggleStrikethrough={() => toggleStrikethrough(item.id)}
                      />
                    </div>
                  {/if}
                  <strong class:struck={item.struck}>{item.title || "Untitled"}</strong>
                  <span class="meta">{item.steps.length} step{item.steps.length === 1 ? "" : "s"} · {new Date(item.lastModified).toLocaleDateString()}</span>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </main>

  {#if selectMode}
    <SelectionActionBar
      selectedCount={selectedIds.size}
      itemLabel={activeView === "notes" ? "note" : "todo"}
      {canMerge}
      onCancel={exitSelectMode}
      onDelete={handleDeleteSelected}
      onSend={handleSendSelected}
      onMerge={handleMergeSelected}
      onExport={handleExportSelected}
    />
  {/if}

  <ConfirmDialog
    bind:open={showMergeConfirm}
    title="Delete the originals?"
    description="They've been combined into '{pendingMerge?.merged.title ?? 'the merged item'}'. Keep them separately, or remove them now that they're merged?"
    confirmLabel="Delete originals"
    danger
    onconfirm={confirmDeleteMergeSources}
    oncancel={keepMergeSources}
  />
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 100vw;
    overflow-x: hidden;
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
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-5) var(--space-4);
  }
  .content.with-bar {
    /* SelectionActionBar is position:fixed at the bottom — without this
       its ~64px would sit on top of the last row of cards instead of
       leaving room for them. */
    padding-bottom: calc(var(--space-5) + 64px);
  }
  .inner {
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }
  .controls {
    display: flex;
    gap: var(--space-3);
    min-width: 0;
  }
  .search {
    flex: 1;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .sort {
    flex-shrink: 0;
    max-width: 40%;
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
    flex-wrap: wrap;
  }
  .section-header h2 {
    font-family: var(--font-display);
    font-size: 19px;
    color: var(--text-hi);
    margin: 0;
    min-width: 0;
    overflow-wrap: break-word;
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
    position: relative;
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
  .todo-item.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .todo-item .meta {
    font-size: 12px;
    color: var(--text-faint);
  }
  .todo-item .select-check {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg);
  }
  .todo-item .select-check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .todo-item .todo-overflow {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
  }
  .todo-item strong.struck {
    text-decoration: line-through;
    color: var(--text-lo);
  }

  @media (max-width: 480px) {
    .content {
      padding-left: var(--space-3);
      padding-right: var(--space-3);
    }
    .grid {
      grid-template-columns: 1fr;
    }
    .controls {
      flex-wrap: wrap;
    }
    .sort {
      max-width: none;
      flex: 1 1 auto;
    }
    .section-header h2 {
      font-size: 17px;
    }
  }
</style>
