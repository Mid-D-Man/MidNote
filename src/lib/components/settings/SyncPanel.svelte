<script lang="ts">
  // Settings -> Account -> Sync. Shows how sync is doing and lets the person run it.
  //
  //   status        "Syncing…" / "Last synced 5 min ago" / "Not synced yet", plus what is waiting
  //   Sync now      the same thing the cloud button in the header does
  //   other account this phone's notes were synced with a different account: the person decides
  //                 (never merged automatically)
  import Button from "$lib/components/ui/Button/Button.svelte";
  import { syncStatus, syncNow, adoptThisAccount, refreshWaiting } from "$lib/stores/sync.svelte";
  import { formatWhen } from "$lib/online/syncMessages";
  import { onMount } from "svelte";

  onMount(() => {
    refreshWaiting();
  });

  const statusLine = $derived(syncStatus.running ? "Syncing…" : syncStatus.lastSyncAt ? `Last synced ${formatWhen(syncStatus.lastSyncAt)}` : "Not synced yet");
  const waitingLine = $derived(syncStatus.waiting === 0 ? "Nothing waiting to be sent" : `${syncStatus.waiting} ${syncStatus.waiting === 1 ? "change" : "changes"} waiting to be sent`);
  const problem = $derived(syncStatus.outcome === "failed" || syncStatus.outcome === "partial" ? syncStatus.message : null);
</script>

<div class="sync">
  <p class="lead">Sync</p>
  <p class="status" role="status" aria-live="polite">{statusLine}</p>
  <p class="fine">{waitingLine}</p>
  {#if syncStatus.mismatch}
    <div class="notice" role="alert">
      <p class="fine strong">These notes were synced with a different account.</p>
      <p class="fine">Adding them to this account puts a copy of everything on this phone into it. Nothing is deleted from either side. If you don't want that, leave it and sign back in to the other account.</p>
      <div class="actions">
        <Button variant="default" onclick={() => void adoptThisAccount()} disabled={syncStatus.running} aria-label="Add this phone's notes to this account">Add this phone's notes to this account</Button>
      </div>
    </div>
  {/if}
  {#if problem}
    <p class="notice" class:error={syncStatus.outcome === "failed"} role="status">{problem}</p>
  {/if}
  <div class="actions">
    <Button variant="outline" onclick={() => void syncNow({ toast: true })} disabled={syncStatus.running} aria-label="Sync now">{syncStatus.running ? "Syncing…" : "Sync now"}</Button>
  </div>
  <p class="fine">Locked notes are stored locked. Every other note, todo and board is stored on MidManStudio's server as readable text, tied to your account. Themes, icons and fonts stay on this phone.</p>
</div>

<style>
  .sync {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--hairline);
  }
  .lead {
    margin: 0;
    font-size: 15px;
    color: var(--text-hi);
  }
  .status {
    margin: 0;
    font-size: 14px;
    color: var(--text-hi);
  }
  .fine {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-lo);
  }
  .fine.strong {
    color: var(--text-hi);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .notice {
    margin: 0;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .notice.error {
    color: var(--danger);
    background: var(--danger-wash);
    border-color: var(--danger);
  }
</style>
