<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import { getTrashed, restoreEntry, purgeEntry } from "$lib/stores/entries.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { Entry } from "$lib/types/entry";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // Re-reads entries (a $state array) on every render Svelte gives this
  // component while `open` — cheap at this app's realistic trash size,
  // and simpler/more robust than trying to cache a sorted copy across
  // restores/purges from inside this same sheet.
  const trashed = $derived(getTrashed());

  // One shared dialog for whichever row's "Delete forever" was tapped,
  // same "sequential, not nested" shape as every other confirm flow in
  // this app (CardOverflowMenu, the three editor headers) — never more
  // than one Sheet/ConfirmDialog pair open at once.
  let pendingPurge: Entry | null = $state(null);

  function typeLabel(entry: Entry): string {
    return entry.type === "regular" ? "Note" : entry.type === "todo" ? "Todo" : "Board";
  }

  // Deliberately coarse (days only, rounded down) — this is "how long
  // ago, roughly" for a list a user glances at occasionally, not a
  // precise timestamp; "0 days" bucket reads as "today" instead of a
  // slightly-odd "0 days ago".
  function deletedLabel(deletedAt: string): string {
    const days = Math.floor((Date.now() - new Date(deletedAt).getTime()) / (24 * 60 * 60 * 1000));
    if (days <= 0) return "Deleted today";
    if (days === 1) return "Deleted yesterday";
    return `Deleted ${days} days ago`;
  }

  function handleRestore(entry: Entry) {
    breadcrumb(`trash: restore tapped, id=${entry.id}`);
    restoreEntry(entry.id);
    pushToast({ title: "Restored", description: `"${entry.title || "Untitled"}" is back in your list.` });
  }

  function handlePurgeTapped(entry: Entry) {
    breadcrumb(`trash: delete forever tapped, id=${entry.id}`);
    pendingPurge = entry;
  }

  function handlePurgeConfirmed() {
    if (!pendingPurge) return;
    breadcrumb(`trash: delete forever confirmed, id=${pendingPurge.id}`);
    purgeEntry(pendingPurge.id);
    pushToast({ title: "Deleted for good", variant: "destructive" });
    pendingPurge = null;
  }
</script>

<Sheet bind:open side="left" title="Trash">
  <p class="hint">Items stay here for 30 days, then delete automatically.</p>

  {#if trashed.length === 0}
    <p class="empty">Trash is empty.</p>
  {:else}
    <ul class="trash-list">
      {#each trashed as entry (entry.id)}
        <li class="trash-row">
          <div class="info">
            <span class="type">{typeLabel(entry)}</span>
            <span class="title">{entry.title || "Untitled"}</span>
            <span class="deleted">{deletedLabel(entry.deletedAt ?? new Date().toISOString())}</span>
          </div>
          <div class="row-actions">
            <Button variant="ghost" size="icon" onclick={() => handleRestore(entry)} aria-label="Restore">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" />
              </svg>
            </Button>
            <Button variant="ghost" size="icon" onclick={() => handlePurgeTapped(entry)} aria-label="Delete forever">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<ConfirmDialog
  open={pendingPurge !== null}
  title="Delete forever?"
  description="This can't be undone — {pendingPurge?.title || 'this item'} will be gone for good."
  confirmLabel="Delete Forever"
  danger
  onconfirm={handlePurgeConfirmed}
  oncancel={() => (pendingPurge = null)}
/>

<style>
  .hint {
    font-size: 13px;
    color: var(--text-faint);
    margin: 0 0 var(--space-3);
  }
  .empty {
    font-size: 14px;
    color: var(--text-faint);
    text-align: center;
    padding: var(--space-6) 0;
  }
  .trash-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .trash-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
    min-width: 0;
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .type {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-faint);
  }
  .title {
    font-size: 14px;
    color: var(--text-hi);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .deleted {
    font-size: 12px;
    color: var(--text-faint);
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
</style>
