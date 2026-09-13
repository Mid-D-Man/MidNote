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
  import TagsPopup from "$lib/components/shared/TagsPopup/TagsPopup.svelte";
  import { entries, saveEntry, removeEntry, toggleBookmark, toggleStrikethrough, togglePinned } from "$lib/stores/entries.svelte";
  import type { Note, Todo, Entry } from "$lib/types/entry";
  import { noteTags, todoTags, sync as syncTags, registerTag, unregisterTag } from "$lib/stores/tags.svelte";
  import { createNote } from "$lib/storage";
  import { stripHtml, plainTextToHtml } from "$lib/utils/richText";
  import { createLongPressHandlers } from "$lib/utils/longPress";
  import { mergeNotes, mergeTodos, buildExportFiles, downloadFiles, type ExportFormat } from "$lib/utils/selectionActions";
  import { shareFiles } from "$lib/utils/share";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { resolveTheme, hexToRgba, getIconGlyph, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import { appBodyTheme } from "$lib/stores/settings.svelte";
  import { lockEntry, unlockEntry } from "$lib/utils/lockFlow";

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
  // Per-item, not a single flag — the list can hold many todos, and
  // only the one actually mid-invoke() should show a spinner/block taps.
  // NoteCard tracks this itself internally (it owns exactly one item);
  // there's no dedicated Todo component to own an equivalent, so it
  // lives here instead. Reassigned (not mutated in place) each time so
  // Svelte's reactivity actually notices the Set changed — `.add()`/
  // `.delete()` alone on a $state Set don't trigger a re-render.
  let lockBusyIds = $state<Set<string>>(new Set());
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

  const sortedItems = $derived.by(() => {
    const base = [...filteredItems].sort((a, b) => {
      if (sortBy === "recent") return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      if (sortBy === "alphabetical") return a.title.localeCompare(b.title);
      return (b.isBookmarked ? 1 : 0) - (a.isBookmarked ? 1 : 0);
    });
    // Pin floats an item to the top of the browse list, but only while
    // actually browsing — the moment there's a search query the person
    // is looking for something specific, and pin order re-sorting the
    // matches around would work against them, not for them. Tag
    // filtering doesn't count as "searching" here, only the text box.
    if (searchQuery.trim()) return base;
    const pinned = base.filter((i) => i.isPinned);
    const rest = base.filter((i) => !i.isPinned);
    return [...pinned, ...rest];
  });

  // Landing-page BODY theme (Settings) — everything on this page except
  // the top app-bar. CORRECTED mapping, confirmed against an annotated
  // screenshot: "Header" is specifically AppHeader.svelte's own <header>
  // (hamburger, "MidNote" wordmark, sync icon) — that component now
  // resolves appHeaderTheme itself (see its own header comment), so
  // there's nothing to compute for it here. "Body" is genuinely
  // everything else, including the Notes/Todos tab row below
  // AppHeader — .view-tabs deliberately gets NO wash of its own below;
  // it's a transparent child sitting inside this same <main>, so
  // .page's background-attachment:fixed image/color already shows
  // straight through it, which is exactly the desired look.
  const appBodyResolved = $derived(resolveTheme(appBodyTheme.value, customThemes));
  const pageBodyStyle = $derived(
    appBodyResolved.kind === "color"
      ? `background: ${hexToRgba(appBodyResolved.color, 0.16)};`
      : appBodyResolved.kind === "image"
        ? // BUGFIX: text/UI sitting directly on the body area (the Tags
          // section's heading and "Add Tag" button specifically — see
          // .tags-header/.btn-outline overrides below) had no contrast
          // handling at all before this; getImageTextColorVars gives
          // every descendant the right --theme-text-*/--theme-tag-*
          // variables to use, picked per-image via colorthief rather
          // than assumed.
          `background-image: url(${appBodyResolved.dataUrl}); background-size: cover; background-attachment: fixed; ${getImageTextColorVars(appBodyResolved.textColor)}`
        : "",
  );
  // .view-tabs has its own deliberate --surface background in its base
  // CSS (a shade lighter than .page's --bg, by design, in the
  // untheened default look) — that's unrelated to theming and stays
  // untouched when no body theme is set. Only override it to transparent
  // when a body theme actually IS active, so .page's background (image
  // or color, whichever was picked) shows straight through instead of
  // this row cutting a solid-colored gap out of it.
  const viewTabsStyle = $derived(appBodyResolved.kind !== "none" ? "background: transparent;" : "");

  function todoItemStyle(todo: Todo): string {
    const resolved = resolveTheme(todo.headerTheme, customThemes);
    if (resolved.kind === "color") return `border-left: 4px solid ${resolved.color}; background: ${hexToRgba(resolved.color, 0.08)};`;
    // BUGFIX — same as NoteCard.svelte's identical fix: text used to be
    // forced to a fixed white hierarchy unconditionally for ANY image
    // theme; now it's the earned, per-image textColor from colorthief
    // (computed once at upload — see CustomTheme.textColor).
    if (resolved.kind === "image")
      return `background-image: url(${resolved.dataUrl}); background-size: cover; background-position: center; ${getImageTextColorVars(resolved.textColor)}`;
    return "";
  }

  const selectedEntries = $derived(entries.filter((e) => selectedIds.has(e.id)));
  const selectionHasEncrypted = $derived(selectedEntries.some((e) => e.encrypted));
  // Merging concatenates content/steps directly (see selectionActions.ts)
  // — a locked entry's real content lives inside its encrypted payload,
  // not in those fields (they're cleared while locked), so merging one
  // in would silently produce a merged item missing that entry's actual
  // content entirely, and then — since a merge normally offers to
  // delete its sources afterward — risk the original locked content
  // being deleted with nothing real ever having made it into the
  // result. Blocked outright rather than merging "around" it.
  const canMerge = $derived(selectedIds.size >= 2 && !selectionHasEncrypted);

  function switchView(view: "notes" | "todos") {
    activeView = view;
    selectedTag = null;
    sortBy = "recent";
    exitSelectMode();
  }

  // BUGFIX (data-safety): this used to navigate straight into a locked
  // entry's editor route regardless of encrypted state — harmless to
  // VIEW (the locked-placeholder screen shows no real content until
  // unlocked, same as before), but it meant a locked note/todo could be
  // fully opened, and from there even deleted (see CardOverflowMenu's
  // now-gated Delete), without ever proving you know its password.
  // Unlocking right here, before navigating at all, closes that for
  // both notes and todos through this one shared entry point — NoteCard
  // routes its own tap through this exact function via its `onClick`
  // prop, so nothing extra is needed on that side beyond the
  // `unlockingToOpen` prop below for matching spinner feedback.
  async function handleClick(id: string) {
    const item = [...notes, ...todos].find((i) => i.id === id);
    if (!item) return;
    if (item.encrypted) {
      lockBusyIds = new Set(lockBusyIds).add(id);
      try {
        const unlocked = await unlockEntry(item);
        if (!unlocked) return; // cancelled or gave up — stay on the list, never navigate
      } finally {
        const next = new Set(lockBusyIds);
        next.delete(id);
        lockBusyIds = next;
      }
    }
    goto(item.type === "todo" ? `/todo/${id}` : `/note/${id}`);
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

  async function handleDownloadSingle(id: string) {
    const item = entries.find((e) => e.id === id);
    if (!item) return;
    await downloadFiles(buildExportFiles([item], "separate"));
    pushToast({ title: "Downloaded" });
  }

  // NoteCard's own onToggleLock passes the Note object it already has;
  // the inline todo row (Todo has no dedicated component of its own)
  // does the same with a Todo — either way this just picks the right
  // direction and hands off to lockFlow.ts, which owns the actual
  // dialogs/invoke calls/entry mutation.
  async function handleToggleLock(item: Note | Todo) {
    // Same new-Set-reassignment pattern as toggleSelect above — Svelte 5
    // $state doesn't fire on in-place Set.add()/.delete(), only on
    // reassigning the binding itself.
    lockBusyIds = new Set(lockBusyIds).add(item.id);
    try {
      if (item.encrypted) await unlockEntry(item);
      else await lockEntry(item);
    } finally {
      const next = new Set(lockBusyIds);
      next.delete(item.id);
      lockBusyIds = next;
    }
  }

  // Tags popup for the TODO inline row specifically — NoteCard handles
  // its own equivalent internally (it already owns `note` directly),
  // but the todo row has no dedicated component of its own, so this
  // page tracks which one (if any) currently has the popup open.
  // Kept as two separate pieces of state on purpose: tagsPopupOpen is
  // what TagsPopup actually bind:opens (so its own internal close —
  // tapping the scrim — correctly flows back here); tagsPopupFor just
  // tracks which todo it's for and is fine staying stale once closed,
  // same as this page's pendingMerge already does.
  let tagsPopupFor = $state<Todo | null>(null);
  let tagsPopupOpen = $state(false);
  function handleAddTagTo(todo: Todo, tag: string) {
    todo.tags = [...todo.tags, tag];
    registerTag("todos", tag);
    saveEntry(todo);
  }
  function handleRemoveTagFrom(todo: Todo, tag: string) {
    todo.tags = todo.tags.filter((t) => t !== tag);
    saveEntry(todo);
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
      await downloadFiles(files);
      pushToast({ title: "Sharing isn't available here", description: "Downloaded instead." });
      exitSelectMode();
    }
  }

  function handleMergeSelected() {
    if (selectionHasEncrypted) {
      pushToast({ title: "Can't merge a locked item", description: "Unlock it first, or deselect it to merge the rest.", variant: "destructive" });
      return;
    }
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

  async function handleExportSelected(format: ExportFormat) {
    breadcrumb(`selection: exporting ${selectedIds.size} items as ${format}`);
    await downloadFiles(buildExportFiles(selectedEntries, format));
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
    if (lockBusyIds.has(id)) return;
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
  <main class="page" class:body-has-image={appBodyResolved.kind === "image"} style={pageBodyStyle}>
    <AppHeader />

    <div class="view-tabs" style={viewTabsStyle}>
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
                  onTogglePin={togglePinned}
                  unlockingToOpen={lockBusyIds.has(item.id)}
                />
              {:else}
                <div
                  class="todo-item"
                  class:selected={selectedIds.has(item.id)}
                  class:has-image-theme={resolveTheme(item.headerTheme, customThemes).kind === "image"}
                  style={todoItemStyle(item)}
                  role="button"
                  tabindex="0"
                  onclick={() => handleTodoClick(item.id)}
                  onkeydown={(e) => e.key === "Enter" && handleTodoClick(item.id)}
                  {...todoPressHandlers(item.id)}
                >
                  {#if resolveTheme(item.headerTheme, customThemes).kind === "image"}
                    <div class="theme-scrim" aria-hidden="true"></div>
                  {/if}
                  {#if selectMode}
                    <div class="select-check" class:checked={selectedIds.has(item.id)} aria-hidden="true">
                      {#if selectedIds.has(item.id)}
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      {/if}
                    </div>
                  {:else}
                    <!-- Left corner, matching NoteCard's .corner-actions
                         placement — moved from the right so the new
                         bookmark star (below) can take the right
                         corner, same as NoteCard, instead of the two
                         fighting over the same spot. -->
                    <div class="todo-overflow">
                      {#if item.isPinned}
                        <span class="pin-indicator" aria-label="Pinned" title="Pinned">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                            <path d="M12 17v5" /><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
                          </svg>
                        </span>
                      {/if}
                      <CardOverflowMenu
                        itemLabel="todo"
                        struck={item.struck}
                        pinned={item.isPinned}
                        encrypted={item.encrypted}
                        busy={lockBusyIds.has(item.id)}
                        onDelete={() => handleDeleteSingle(item.id)}
                        onDownload={() => handleDownloadSingle(item.id)}
                        onToggleStrikethrough={() => toggleStrikethrough(item.id)}
                        onTogglePin={() => togglePinned(item.id)}
                        onToggleLock={() => handleToggleLock(item)}
                        onOpenTags={() => {
                          tagsPopupFor = item;
                          tagsPopupOpen = true;
                        }}
                      />
                    </div>
                    <!-- Todos never had this at all before — NoteCard's
                         had one since Pin/Theme v1, this was just a gap.
                         Same markup/behavior as NoteCard's own bookmark
                         button, just wired to this item instead. -->
                    <button
                      class="bookmark"
                      class:active={item.isBookmarked}
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleBookmark(item.id);
                      }}
                      onpointerdown={(e) => e.stopPropagation()}
                      onpointerup={(e) => e.stopPropagation()}
                      onpointermove={(e) => e.stopPropagation()}
                      onpointercancel={(e) => e.stopPropagation()}
                      aria-label="Toggle bookmark"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill={item.isBookmarked ? "currentColor" : "none"} stroke="currentColor" stroke-width="2">
                        <polygon points="12 2 15.09 8.63 22 9.24 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.24 8.91 8.63 12 2" />
                      </svg>
                    </button>
                  {/if}
                  <div class="title-row">
                    {#if getIconGlyph(item.icon)}
                      <span class="icon-badge" aria-hidden="true">{getIconGlyph(item.icon)}</span>
                    {/if}
                    <strong class:struck={item.struck}>{item.title || "Untitled"}</strong>
                  </div>
                  <!-- Same as NoteCard.svelte: while locked, only name +
                       icon + tags show. Todos never showed tags at all
                       before this (a pre-existing gap unrelated to
                       encryption, on top of the actual bug) — added
                       here unconditionally, same as NoteCard, rather
                       than only while locked, which would have made a
                       locked todo show MORE than an unlocked one. -->
                  {#if !item.encrypted}
                    <span class="meta">
                      {item.steps.length} step{item.steps.length === 1 ? "" : "s"} · {new Date(item.lastModified).toLocaleDateString()}
                    </span>
                  {/if}
                  {#if item.tags.length > 0}
                    <div class="tags">
                      {#each item.tags as tag (tag)}
                        <span class="tag">{tag}</span>
                      {/each}
                    </div>
                  {/if}
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
      {selectionHasEncrypted}
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

  <TagsPopup
    bind:open={tagsPopupOpen}
    tags={tagsPopupFor?.tags ?? []}
    availableTags={todoTags}
    onAddTag={(tag) => tagsPopupFor && handleAddTagTo(tagsPopupFor, tag)}
    onRemoveTag={(tag) => tagsPopupFor && handleRemoveTagFrom(tagsPopupFor, tag)}
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
  /* BUGFIX: the "Tags" heading has no background of its own (it's a
     plain <h3>, not a themed component), so it still needs an explicit
     override here — unlike "Add Tag" (a Button variant="outline"),
     which now picks up --theme-tag-bg/--theme-text-hi automatically via
     Button.svelte's own CSS var fallback, since those vars are already
     set on this file's .page (an ancestor) whenever body-has-image is
     active. Scoped to body-has-image specifically so nothing changes
     for the untheemed default look or a color-preset body theme (the
     low-alpha wash there was never the actual problem). */
  .body-has-image .tags-header h3 {
    color: var(--theme-text-hi);
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
  /* Same rules as NoteCard.svelte's .tags/.tag — todos never had a tags
     display of their own before this. */
  .todo-item .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .todo-item .tag {
    font-size: 11px;
    padding: 2px var(--space-2);
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 500;
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
    left: var(--space-2);
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .todo-item .pin-indicator {
    width: 16px;
    height: 16px;
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  /* Same markup/behavior/look as NoteCard.svelte's own .bookmark — this
     is that same feature, just missing from todos until now. Right
     corner, matching NoteCard, now that .todo-overflow (above) has
     moved to the left to make room for it. */
  .todo-item .bookmark {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    cursor: pointer;
  }
  .todo-item .bookmark:hover {
    background: var(--surface-raised);
  }
  .todo-item .bookmark.active {
    color: var(--accent-2);
  }
  /* Same title-row/icon-badge pattern as NoteCard.svelte — the icon
     badge (when set) sits just before the title text. Margin here
     reserves room for the corner-actions cluster now on the left and
     the bookmark star on the right, same reasoning as NoteCard's own
     title-row margin. */
  .todo-item .title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    margin: 0 var(--space-6) 0 48px;
  }
  .todo-item .icon-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface-raised);
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }
  .todo-item .title-row strong {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .todo-item strong.struck {
    text-decoration: line-through;
    color: var(--text-lo);
  }
  .todo-item .theme-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(4, 6, 16, 0.15) 0%, rgba(4, 6, 16, 0.72) 100%);
    border-radius: inherit;
  }
  /* --theme-text-hi/mid/lo and --theme-tag-bg/text are set inline via
     todoItemStyle (see getImageTextColorVars) — light or dark depending
     on this specific image's actual sampled color, not assumed. Same
     reasoning as NoteCard.svelte's identical override. */
  .todo-item.has-image-theme {
    color: var(--theme-text-hi);
  }
  .todo-item.has-image-theme .meta {
    color: var(--theme-text-lo);
  }
  .todo-item.has-image-theme .tag {
    background: var(--theme-tag-bg);
    color: var(--theme-tag-text);
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
