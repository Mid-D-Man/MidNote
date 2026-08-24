<script lang="ts">
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import AuthDialog from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import SettingsSheet from "$lib/components/layout/SettingsSheet/SettingsSheet.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";

  let menuOpen = $state(false);
  let authOpen = $state(false);
  let settingsOpen = $state(false);

  // TODO: real Supabase auth + the Storage-bucket sync described in the
  // sync-architecture discussion — this just tells the user honestly that
  // it isn't wired up yet rather than pretending to sync.
  function handleSync() {
    pushToast({
      title: "Sync not set up yet",
      description: "Cloud sync (Supabase) isn't wired up in MidNote yet.",
    });
  }
</script>

<header class="app-header">
  <Button variant="ghost" size="icon" onclick={() => (menuOpen = true)}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  </Button>

  <h1>MidNote</h1>

  <Button variant="ghost" size="icon" onclick={handleSync}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  </Button>
</header>

<Sheet bind:open={menuOpen} side="left" title="Menu">
  <nav class="menu-nav">
    <Button variant="ghost" onclick={() => { menuOpen = false; authOpen = true; }}>
      Login
    </Button>
    <Button variant="ghost" onclick={() => { menuOpen = false; authOpen = true; }}>
      Sign Up
    </Button>
    <Button variant="ghost" onclick={() => { menuOpen = false; settingsOpen = true; }}>
      Settings
    </Button>
  </nav>
</Sheet>

<AuthDialog bind:open={authOpen} />
<SettingsSheet bind:open={settingsOpen} />

<style>
  .app-header {
    height: 15vh;
    min-height: 80px;
    max-height: 120px;
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
    padding: 0 var(--space-4);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 17px;
    color: var(--text-hi);
    margin: 0;
  }
  .menu-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
</style>
