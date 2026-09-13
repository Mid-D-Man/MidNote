<script lang="ts">
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import AuthDialog from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import SettingsSheet from "$lib/components/layout/SettingsSheet/SettingsSheet.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { appHeaderTheme } from "$lib/stores/settings.svelte";
  import { resolveTheme, hexToRgba, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";

  let menuOpen = $state(false);
  let authOpen = $state(false);
  let settingsOpen = $state(false);

  // This <header> — hamburger, "MidNote" wordmark, sync icon — is what
  // the landing-page "Header" theme slot actually means (confirmed
  // against a real annotated screenshot: this bar specifically, not the
  // Notes/Todos tab row below it, which is genuinely part of "Body"
  // now — see +page.svelte's pageBodyStyle comment). Self-contained,
  // same pattern as NoteEditorHeader/TodoHeader's own headerStyle:
  // this component owns its own theme resolution rather than the
  // parent computing and passing down a style string.
  const resolvedHeaderTheme = $derived(resolveTheme(appHeaderTheme.value, customThemes));
  const headerStyle = $derived(
    resolvedHeaderTheme.kind === "color"
      ? `background: ${hexToRgba(resolvedHeaderTheme.color, 0.16)};`
      : resolvedHeaderTheme.kind === "image"
        ? // BUGFIX: this was written in the same round that fixed the
          // header/body mapping (before the colorthief contrast system
          // existed) and never got backfilled — the h1/icon buttons
          // below had no dynamic contrast handling at all until now,
          // same class of gap as NoteEditorHeader/TodoHeader's identical
          // fix.
          `background-image: linear-gradient(rgba(4,6,16,0.35), rgba(4,6,16,0.35)), url(${resolvedHeaderTheme.dataUrl}); background-size: cover; background-position: center; ${getImageTextColorVars(resolvedHeaderTheme.textColor)}`
        : "",
  );

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

<header class="app-header" style={headerStyle}>
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
    /* Same fallback pattern as Button.svelte's .btn-ghost — see that
       file's comment. Falls back to the normal token when no header
       theme (or a non-image one) is active. */
    color: var(--theme-text-hi, var(--text-hi));
    margin: 0;
  }
  .menu-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
</style>
