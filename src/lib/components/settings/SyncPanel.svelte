<script lang="ts">
  // Settings -> Account -> Sync. Shows how sync is doing and lets the person run it.
  //
  //   status        "Syncing…" / "Last synced 5 min ago" / "Not synced yet", plus what is waiting
  //   Sync now      the same thing the cloud button in the header does
  //   Restore       reads everything the account has from the start and brings it down; sends nothing
  //   Sync automatically   OFF by default: sync runs only when the person asks. ON: it also runs when the app
  //                 opens, when they come back to it, and shortly after they edit.
  //   other account this phone's notes were synced with a different account: the person decides
  //                 (never merged automatically)
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import { syncStatus, syncPrefs, syncNow, restoreFromCloud, adoptThisAccount, refreshWaiting, setAutoSync } from "$lib/stores/sync.svelte";
  import { settingsSyncPrefs, setSettingsSync } from "$lib/stores/settingsSync.svelte";
  import { formatWhen } from "$lib/online/syncMessages";
  import { onMount } from "svelte";

  onMount(() => {
    refreshWaiting();
  });

  const statusLine = $derived(syncStatus.running ? "Syncing…" : syncStatus.lastSyncAt ? `Last synced ${formatWhen(syncStatus.lastSyncAt)}` : "Not synced yet");
  const waitingLine = $derived(
    syncStatus.waiting === 0
      ? "Nothing waiting to be sent"
      : `${syncStatus.waiting} ${syncStatus.waiting === 1 ? "change" : "changes"} waiting to be sent${syncPrefs.auto ? "" : ". Tap Sync now to send them."}`,
  );
  const problem = $derived(syncStatus.outcome === "failed" || syncStatus.outcome === "partial" ? syncStatus.message : null);
</script>

<div class="sync">
  <p class="lead">Sync</p>
  <p class="status" role="status" aria-live="polite">{statusLine}</p>
  <p class="fine">{waitingLine}</p>
  {#if syncStatus.mismatch}
    <div class="notice" role="alert">
      <p class="fine strong">These notes were synced with a different account.</p>
      <p class="fine">Adding them puts a copy of everything on this phone into this account. Nothing is deleted.</p>
      <div class="actions">
        <Button variant="default" onclick={() => void adoptThisAccount()} disabled={syncStatus.running} aria-label="Add this phone's notes to this account">Add this phone's notes to this account</Button>
      </div>
    </div>
  {/if}
  {#if problem}
    <p class="notice" class:error={syncStatus.outcome === "failed"} role="status">{problem}</p>
  {/if}
  <SettingsRow label="Sync automatically" desc={syncPrefs.auto ? "On: syncs by itself." : "Off: sync when you tap the cloud button or Sync now."}>
    <Switch checked={syncPrefs.auto} aria-label="Sync automatically" onCheckedChange={(v) => setAutoSync(v)} />
  </SettingsRow>
  <SettingsRow label="Sync my settings" desc={settingsSyncPrefs.on ? "On: your settings follow you to your other phones." : "Off: this phone's settings stay on this phone."}>
    <Switch checked={settingsSyncPrefs.on} aria-label="Sync my settings" onCheckedChange={(v) => setSettingsSync(v)} />
  </SettingsRow>
  {#if syncStatus.settingsNote}
    <p class="fine" role="status">{syncStatus.settingsNote}</p>
  {/if}
  <div class="actions">
    <Button variant="outline" onclick={() => void syncNow({ toast: true })} disabled={syncStatus.running} aria-label="Sync now">{syncStatus.running ? "Syncing…" : "Sync now"}</Button>
    <Button variant="outline" onclick={() => void restoreFromCloud()} disabled={syncStatus.running} aria-label="Restore from cloud">Restore from cloud</Button>
  </div>
  <p class="fine">
    {#if syncStatus.lastSyncAt}
      Restore brings everything in your account down to this phone.
    {:else}
      Not synced yet. Restore brings your cloud notes here.
    {/if}
  </p>
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
