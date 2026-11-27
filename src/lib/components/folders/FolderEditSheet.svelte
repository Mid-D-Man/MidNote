<script lang="ts">
  // One folder's settings (round 47): its name, its OWN tags, where it lives, and delete.
  // Tags set here are inherited by everything inside (utils/folders.ts effectiveTags); the
  // ones inherited from folders above are listed read-only, since they are changed there.
  // The tags are picked in the same Tags popup the cards' ⋮ menu opens (search, create, one row per tag): the row below
  // opens it, and its Back arrow returns here.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import TagsPopup from "$lib/components/shared/TagsPopup/TagsPopup.svelte";
  import { entries, saveEntry } from "$lib/stores/entries.svelte";
  import { noteTags, todoTags, boardTags } from "$lib/stores/tags.svelte";
  import { folderState, deleteFolder, requestMove, renameFolder, FOLDER_NAME_MAX } from "$lib/stores/folders.svelte";
  import { descendantIds, effectiveTags } from "$lib/utils/folders";
  import { pushToast } from "$lib/stores/toast.svelte";
  import type { Folder } from "$lib/types/entry";

  let { open = $bindable(false), folderId }: { open?: boolean; folderId: string | null } = $props();

  const folder = $derived(folderId ? (entries.find((e): e is Folder => e.type === "folder" && e.id === folderId) ?? null) : null);
  const tags = $derived(folder ? effectiveTags(folderState.view, folder.id) : null);
  const inside = $derived(folder ? descendantIds(folderState.view, folder.id).length : 0);
  // every tag in use, plus this folder's own (so one taken off can be put back)
  const suggestions = $derived([...new Set([...noteTags, ...todoTags, ...boardTags, ...(folder?.tags ?? [])])]);

  let name = $state("");
  let confirmDelete = $state(false);
  let tagsOpen = $state(false);
  $effect(() => {
    if (open && folder) {
      name = folder.title;
      confirmDelete = false;
    }
  });

  function commitName() {
    if (!folder) return;
    const r = renameFolder(folder.id, name);
    if (!r.ok) name = folder.title; // an empty name is not allowed: put the old one back
  }

  function addTag(tag: string) {
    if (!folder || folder.tags.includes(tag)) return;
    saveEntry({ ...folder, tags: [...folder.tags, tag] });
  }
  function removeTag(tag: string) {
    if (!folder) return;
    saveEntry({ ...folder, tags: folder.tags.filter((t) => t !== tag) });
  }

  // Sequential, not nested: the folder sheet goes down and the Tags popup comes up; Back swaps them again.
  function openTags() {
    open = false;
    tagsOpen = true;
  }
  function backFromTags() {
    tagsOpen = false;
    open = true;
  }

  function moveFolder() {
    if (!folder) return;
    const id = folder.id;
    open = false;
    requestMove([id]);
  }

  function remove(mode: "lift" | "all") {
    if (!folder) return;
    const title = folder.title || "Folder";
    deleteFolder(folder.id, mode);
    open = false;
    pushToast({ title: mode === "all" && inside > 0 ? `"${title}" and ${inside} item${inside === 1 ? "" : "s"} moved to Trash` : `"${title}" moved to Trash`, variant: "destructive" });
  }
</script>

<Sheet bind:open side="bottom" title="Folder">
  {#if folder && tags}
    <div class="body">
      <label class="field">
        <span class="label">Name</span>
        <input class="input" type="text" aria-label="Folder name" maxlength={FOLDER_NAME_MAX} bind:value={name} onblur={commitName} onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      </label>

      <div class="field">
        <span class="label">Tags — everything inside inherits these</span>
        <button type="button" class="tags-row" aria-label="Edit folder tags" onclick={openTags}>
          <span class="tags-summary">
            {#each folder.tags as t (t)}<span class="chip own">{t}</span>{:else}<span class="none">No tags yet</span>{/each}
          </span>
          <svg class="go" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
        </button>
        {#if tags.inherited.length > 0}
          <p class="inherited">
            Also inherited from folders above:
            {#each tags.inherited as t (t.tag)}<span class="chip">{t.tag}</span>{/each}
          </p>
        {/if}
      </div>

      <Button variant="outline" onclick={moveFolder} aria-label="Move this folder">Move this folder…</Button>

      {#if !confirmDelete}
        <Button variant="outline" onclick={() => (confirmDelete = true)} aria-label="Delete folder">Delete folder…</Button>
      {:else}
        <div class="delete-box">
          <p class="warn">Both go to Trash for 30 days.</p>
          <Button variant="outline" onclick={() => remove("lift")} aria-label="Delete folder only">Delete the folder only{inside > 0 ? " — contents move up a level" : ""}</Button>
          {#if inside > 0}
            <Button variant="outline" onclick={() => remove("all")} aria-label="Delete folder and everything inside">Delete the folder and everything inside ({inside})</Button>
          {/if}
          <Button variant="ghost" onclick={() => (confirmDelete = false)}>Keep it</Button>
        </div>
      {/if}
    </div>
  {/if}
</Sheet>

<!-- A sibling of the sheet, not inside it: a sheet's transform would make it the containing block of this one. -->
<TagsPopup bind:open={tagsOpen} tags={folder?.tags ?? []} availableTags={suggestions} onAddTag={addTag} onRemoveTag={removeTag} onBack={backFromTags} />

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .label {
    font-size: 12px;
    color: var(--text-faint);
  }
  .input {
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 15px;
  }
  .tags-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 48px;
    padding: var(--space-2) var(--space-3);
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .tags-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .none {
    font-size: 15px;
    color: var(--text-faint);
  }
  .go {
    flex-shrink: 0;
    color: var(--text-faint);
  }
  .chip.own {
    padding: 4px var(--space-3);
    background: var(--accent-wash);
    color: var(--accent);
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .inherited {
    margin: var(--space-2) 0 0;
    font-size: 12px;
    color: var(--text-faint);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }
  .chip {
    padding: 2px var(--space-2);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-faint);
    font-size: 11px;
  }
  .delete-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .warn {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
