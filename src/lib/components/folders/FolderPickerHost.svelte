<script lang="ts">
  // "Move to folder" (round 47). ONE picker for the whole landing page: a card's menu, the
  // selection bar and a folder's own sheet all just call requestMove(ids) (stores/folders.svelte.ts)
  // and this sheet answers. It lists the folder tree, indented; a folder the chosen items
  // can't go into (itself, one of its own subfolders, too deep) is shown greyed with the reason.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import FolderGlyph from "./FolderGlyph.svelte";
  import { folderState, moveRequest, clearMoveRequest, moveEntriesTo } from "$lib/stores/folders.svelte";
  import { canMove, childrenOf, refusalText } from "$lib/utils/folders";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  const request = $derived(moveRequest.current);
  let open = $state(false);
  $effect(() => {
    open = request !== null;
  });
  // Closing the sheet any way at all (back, swipe, picking) ends the request.
  $effect(() => {
    if (!open && moveRequest.current !== null) clearMoveRequest();
  });

  interface Row {
    id: string | null;
    title: string;
    depth: number;
    reason: string | null; // why it can't be chosen, or null
  }

  const rows = $derived.by<Row[]>(() => {
    if (!request) return [];
    const view = folderState.view;
    const out: Row[] = [{ id: null, title: "Top level", depth: 0, reason: null }];
    const walk = (parent: string | null, depth: number) => {
      const folders = childrenOf(view, parent)
        .filter((id) => view.folders.has(id))
        .sort((a, b) => view.folders.get(a)!.title.localeCompare(view.folders.get(b)!.title));
      for (const id of folders) {
        const check = canMove(view, request.ids, id);
        out.push({ id, title: view.folders.get(id)!.title || "Untitled folder", depth: depth + 1, reason: check.ok ? null : refusalText(check.reason) });
        walk(id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  function pick(row: Row) {
    if (!request || row.reason) return;
    const ids = request.ids;
    const onMoved = request.onMoved;
    const result = moveEntriesTo(ids, row.id);
    if (!result.ok) {
      pushToast({ title: refusalText(result.reason), variant: "destructive" });
      return;
    }
    breadcrumb(`folders: moved ${ids.length} -> ${row.id ?? "top level"}`);
    pushToast({ title: `${ids.length === 1 ? "Moved" : `Moved ${ids.length} items`} to ${row.id === null ? "the top level" : row.title}` });
    open = false;
    onMoved?.();
  }
</script>

<Sheet bind:open side="bottom" title="Move to folder">
  <ul class="rows">
    {#each rows as row (row.id ?? "top")}
      <li>
        <button
          class="row"
          class:disabled={row.reason !== null}
          style="padding-left: calc(var(--space-3) + {row.depth * 18}px)"
          disabled={row.reason !== null}
          aria-label={row.id === null ? "Move to top level" : `Move to ${row.title}`}
          onclick={() => pick(row)}
        >
          <FolderGlyph size={18} />
          <span class="name">{row.title}</span>
          {#if row.reason}<span class="why">{row.reason}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 60dvh;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    text-align: left;
    padding: var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 14px;
    cursor: pointer;
  }
  .row:hover:not(.disabled) {
    background: var(--surface);
  }
  .row.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .why {
    font-size: 11px;
    color: var(--text-faint);
    flex-shrink: 0;
  }
</style>
