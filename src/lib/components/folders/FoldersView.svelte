<script lang="ts">
  // The Folders tab (round 47): a file-manager style browser. Folders first, then the notes,
  // todos and boards filed in the open folder; tap a folder to go in, the breadcrumb to go back
  // out. Long-press selects (Move / Delete). The Notes / Todos / Boards tabs still list everything;
  // this tab is the way to see and arrange it by folder.
  import { goto } from "$app/navigation";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import FolderGlyph from "./FolderGlyph.svelte";
  import FolderEditSheet from "./FolderEditSheet.svelte";
  import LockBadge from "$lib/components/shared/LockBadge/LockBadge.svelte";
  import { entries, removeEntry } from "$lib/stores/entries.svelte";
  import { folderState, folderNav, createFolderIn, deleteFolder, requestMove, FOLDER_NAME_MAX } from "$lib/stores/folders.svelte";
  import { breadcrumbOf, childrenOf, countContents, effectiveTags, MAX_FOLDER_DEPTH } from "$lib/utils/folders";
  import { createLongPressHandlers } from "$lib/utils/longPress";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb as logCrumb } from "$lib/debug/log.svelte";

  const view = $derived(folderState.view);
  const current = $derived(folderNav.currentId);
  const trail = $derived(current ? breadcrumbOf(view, current) : []);
  const depthHere = $derived(current ? view.depth.get(current)! : 0);
  const canAddFolder = $derived(depthHere < MAX_FOLDER_DEPTH);
  const currentTags = $derived(current ? effectiveTags(view, current) : null);

  const folderIds = $derived(
    childrenOf(view, current)
      .filter((id) => view.folders.has(id))
      .sort((a, b) => view.folders.get(a)!.title.localeCompare(view.folders.get(b)!.title))
  );
  const itemIds = $derived(
    childrenOf(view, current)
      .filter((id) => !view.folders.has(id))
      .sort((a, b) => Date.parse(entryOf(b)?.lastModified ?? "") - Date.parse(entryOf(a)?.lastModified ?? ""))
  );

  // The entry record (full object) for fields the folder rules don't carry.
  function entryOf(id: string) {
    return entries.find((e) => e.id === id)!;
  }

  function typeLabel(type: string): string {
    return type === "regular" ? "Note" : type === "todo" ? "Todo" : type === "board" ? "Board" : "Folder";
  }
  function contentsLabel(id: string): string {
    const c = countContents(view, id);
    const parts = [
      c.folders ? `${c.folders} folder${c.folders === 1 ? "" : "s"}` : "",
      c.notes ? `${c.notes} note${c.notes === 1 ? "" : "s"}` : "",
      c.todos ? `${c.todos} todo${c.todos === 1 ? "" : "s"}` : "",
      c.boards ? `${c.boards} board${c.boards === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Empty";
  }

  // ---- selection
  let selectMode = $state(false);
  let selectedIds = $state<Set<string>>(new Set());
  const selectionHasLocked = $derived([...selectedIds].some((id) => entryOf(id)?.encrypted));
  function enterSelect(id: string) {
    selectMode = true;
    selectedIds = new Set([id]);
  }
  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
    if (next.size === 0) selectMode = false;
  }
  function exitSelect() {
    selectMode = false;
    selectedIds = new Set();
  }
  // Moving to another folder leaves the selection behind it.
  $effect(() => {
    void current; // a different folder: the selection no longer matches what's on screen
    exitSelect();
  });

  function open(id: string) {
    const e = view.byId.get(id)!;
    if (e.type === "folder") {
      logCrumb(`folders: open ${id}`);
      folderNav.open(id);
    } else {
      goto(e.type === "todo" ? `/todo/${id}` : e.type === "board" ? `/board/${id}` : `/note/${id}`);
    }
  }
  // A touch is handled by the pointer handlers; the click the browser sends right after it must
  // not act a second time. A click with no pointer press before it (keyboard Enter, assistive
  // tech) still works, same arrangement as the cards on the other tabs.
  const suppressClick = new Set<string>();
  function activate(id: string) {
    if (selectMode) toggleSelect(id);
    else open(id);
  }
  function handleClick(id: string) {
    if (suppressClick.delete(id)) return;
    activate(id);
  }
  function handlersFor(id: string) {
    return createLongPressHandlers({
      onLongPress: () => {
        suppressClick.add(id);
        if (selectMode) toggleSelect(id);
        else enterSelect(id);
      },
      onTap: () => {
        suppressClick.add(id);
        activate(id);
      },
    });
  }

  // ---- creating
  let newMenuOpen = $state(false);
  let nameOpen = $state(false);
  let newName = $state("");
  let nameError = $state("");
  const hereQuery = $derived(current ? `?folder=${current}` : "");

  function startNewFolder() {
    newMenuOpen = false;
    newName = "";
    nameError = "";
    nameOpen = true;
  }
  function createHere() {
    const r = createFolderIn(current, newName);
    if (!r.ok) {
      nameError = r.message;
      return;
    }
    nameOpen = false;
    folderNav.open(r.folder.id);
  }
  function startNew(kind: "note" | "todo" | "board") {
    newMenuOpen = false;
    goto(`/${kind}/new${hereQuery}`);
  }

  // ---- deleting the selection
  let confirmDelete = $state(false);
  const selectedFolderCount = $derived([...selectedIds].filter((id) => view.folders.has(id)).length);
  function deleteSelected() {
    const ids = [...selectedIds];
    // Folders first (their contents move up a level), then the plain entries.
    for (const id of ids) if (view.folders.has(id)) deleteFolder(id, "lift");
    for (const id of ids) if (!view.folders.has(id)) removeEntry(id);
    pushToast({ title: `${ids.length} item${ids.length === 1 ? "" : "s"} moved to Trash`, variant: "destructive" });
    exitSelect();
  }

  let editOpen = $state(false);
</script>

<div class="folders">
  <nav class="trail" aria-label="Folder path">
    <button class="crumb" class:here={current === null} aria-label="Open top level" onclick={() => folderNav.open(null)}>All folders</button>
    {#each trail as f (f.id)}
      <span class="sep" aria-hidden="true">›</span>
      <button class="crumb" class:here={f.id === current} aria-label={`Open ${f.title || "Untitled folder"}`} onclick={() => folderNav.open(f.id)}>{f.title || "Untitled folder"}</button>
    {/each}
  </nav>

  <div class="head">
    <h2>{current ? view.folders.get(current)!.title || "Untitled folder" : "All folders"}</h2>
    <div class="head-actions">
      {#if current && !selectMode}
        <Button variant="outline" size="sm" onclick={() => (editOpen = true)} aria-label="Edit this folder">Edit</Button>
      {/if}
      {#if !selectMode}
        <Button onclick={() => (newMenuOpen = true)} aria-label="Add to this folder">+ New</Button>
      {/if}
    </div>
  </div>

  {#if currentTags && currentTags.all.length > 0}
    <div class="tags" aria-label="Folder tags">
      {#each currentTags.own as tag (tag)}<span class="tag">{tag}</span>{/each}
      {#each currentTags.inherited as t (t.tag)}<span class="tag inherited">{t.tag}</span>{/each}
    </div>
  {/if}

  {#if folderIds.length === 0 && itemIds.length === 0}
    <div class="empty">
      <p>{current ? "This folder is empty." : "No folders yet."}</p>
      <Button size="lg" onclick={() => (newMenuOpen = true)}>{current ? "Add something" : "Create a folder"}</Button>
    </div>
  {:else}
    <ul class="list">
      {#each folderIds as id (id)}
        {@const f = view.folders.get(id)!}
        {@const t = effectiveTags(view, id)}
        <li>
          <div class="row folder" class:selected={selectedIds.has(id)} role="button" tabindex="0" aria-label={`Folder ${f.title || "Untitled folder"}`} {...handlersFor(id)} onclick={() => handleClick(id)} onkeydown={(e) => e.key === "Enter" && activate(id)}>
            <span class="glyph"><FolderGlyph size={22} /></span>
            <div class="info">
              <span class="title">{f.title || "Untitled folder"}</span>
              <span class="sub">{contentsLabel(id)}</span>
              {#if t.all.length > 0}
                <span class="tags">
                  {#each t.own as tag (tag)}<span class="tag">{tag}</span>{/each}
                  {#each t.inherited as x (x.tag)}<span class="tag inherited">{x.tag}</span>{/each}
                </span>
              {/if}
            </div>
            {#if selectMode}<span class="check" class:on={selectedIds.has(id)} aria-hidden="true">{selectedIds.has(id) ? "✓" : ""}</span>{/if}
          </div>
        </li>
      {/each}
      {#each itemIds as id (id)}
        {@const e = entryOf(id)}
        {@const t = effectiveTags(view, id)}
        <li>
          <div class="row" class:selected={selectedIds.has(id)} role="button" tabindex="0" aria-label={`${typeLabel(e.type)} ${e.title || "Untitled"}`} {...handlersFor(id)} onclick={() => handleClick(id)} onkeydown={(ev) => ev.key === "Enter" && activate(id)}>
            <span class="kind">{typeLabel(e.type)}</span>
            <div class="info">
              <span class="title">{e.title || "Untitled"} {#if e.encrypted}<LockBadge />{/if}</span>
              {#if t.all.length > 0}
                <span class="tags">
                  {#each t.own as tag (tag)}<span class="tag">{tag}</span>{/each}
                  {#each t.inherited as x (x.tag)}<span class="tag inherited">{x.tag}</span>{/each}
                </span>
              {/if}
            </div>
            {#if selectMode}<span class="check" class:on={selectedIds.has(id)} aria-hidden="true">{selectedIds.has(id) ? "✓" : ""}</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if selectMode}
  <div class="bar">
    <button class="cancel" onclick={exitSelect} aria-label="Cancel selection">✕</button>
    <span class="count">{selectedIds.size} selected</span>
    <Button variant="outline" size="sm" onclick={() => requestMove([...selectedIds], exitSelect)} aria-label="Move to folder">Move</Button>
    <Button variant="outline" size="sm" disabled={selectionHasLocked} onclick={() => (confirmDelete = true)} aria-label="Delete" title={selectionHasLocked ? "Unlock or deselect the locked item to delete" : "Delete selected"}>Delete</Button>
  </div>
{/if}

<Sheet bind:open={newMenuOpen} side="bottom" title={current ? "Add to this folder" : "Add"}>
  <div class="menu">
    {#if canAddFolder}
      <button class="menu-item" aria-label="New folder here" onclick={startNewFolder}>New folder</button>
    {:else}
      <p class="limit">Folders can only be nested {MAX_FOLDER_DEPTH} deep.</p>
    {/if}
    <button class="menu-item" aria-label="New note here" onclick={() => startNew("note")}>New note</button>
    <button class="menu-item" aria-label="New todo here" onclick={() => startNew("todo")}>New todo</button>
    <button class="menu-item" aria-label="New board here" onclick={() => startNew("board")}>New board</button>
  </div>
</Sheet>

<Sheet bind:open={nameOpen} side="bottom" title="New folder">
  <div class="menu">
    <input class="input" type="text" aria-label="New folder name" placeholder="Folder name" maxlength={FOLDER_NAME_MAX} bind:value={newName} onkeydown={(e) => e.key === "Enter" && createHere()} />
    {#if nameError}<p class="error" role="alert">{nameError}</p>{/if}
    <Button onclick={createHere} aria-label="Create folder">Create folder</Button>
  </div>
</Sheet>

<FolderEditSheet bind:open={editOpen} folderId={current} />

<ConfirmDialog
  bind:open={confirmDelete}
  title="Move to Trash?"
  description={selectedFolderCount > 0 ? "What's inside the selected folders moves up a level; only the folders go to Trash." : "They stay in Trash for 30 days."}
  confirmLabel="Move to Trash"
  danger
  onconfirm={deleteSelected}
  oncancel={() => {}}
/>

<style>
  .folders {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: 96px;
  }
  .trail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    font-size: 13px;
  }
  .crumb {
    background: none;
    border: none;
    padding: 2px var(--space-1);
    color: var(--text-faint);
    cursor: pointer;
    font-size: 13px;
  }
  .crumb.here {
    color: var(--text-hi);
    font-weight: 600;
  }
  .sep {
    color: var(--text-faint);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .head h2 {
    margin: 0;
    font-size: 18px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--surface-raised);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    touch-action: pan-y;
    user-select: none;
  }
  .row.selected {
    border-color: var(--accent);
  }
  .glyph {
    color: var(--accent);
    display: flex;
  }
  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    width: 44px;
    flex-shrink: 0;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .title {
    font-size: 15px;
    color: var(--text-hi);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--text-faint);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .tag {
    font-size: 11px;
    padding: 2px var(--space-2);
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 500;
  }
  /* inherited from a folder above: quieter than a tag set on the item itself */
  .tag.inherited {
    background: var(--surface);
    color: var(--text-faint);
    font-weight: 400;
  }
  .check {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    flex-shrink: 0;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .empty {
    text-align: center;
    color: var(--text-faint);
    padding: var(--space-6) 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }
  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 45;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
    background: var(--surface-raised);
    border-top: 1px solid var(--hairline);
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.28);
  }
  .cancel {
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
  }
  .count {
    flex: 1;
    font-size: 13px;
    color: var(--text-hi);
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .menu-item {
    text-align: left;
    padding: var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 15px;
    cursor: pointer;
  }
  .menu-item:hover {
    background: var(--surface);
  }
  .limit,
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
  .error {
    color: var(--danger, #e5484d);
  }
  .input {
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 15px;
  }
</style>
