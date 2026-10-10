<script lang="ts">
  // Round 42 — the pages under Advanced settings. One route, switched on the
  // address, so a new category is a new entry in settingsSections.ts plus one
  // branch here.
  //   /settings/appearance   theme, fonts (sub-page), note lines
  //   /settings/fonts        default note font + imported fonts   (Back -> Appearance)
  //   /settings/read-aloud   voice, speed, pitch, sample
  //   /settings/trash        what's in Trash, and how long it stays
  //   /settings/backup       back up everything to a file / restore from one
  //   /settings/privacy      app password
  //   /settings/developer    debug panel
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import SettingsPage from "$lib/components/settings/SettingsPage.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import ThemeSwatch from "$lib/components/settings/ThemeSwatch.svelte";
  import AppThemeSheet from "$lib/components/settings/AppThemeSheet.svelte";
  import AppPasswordRow from "$lib/components/settings/AppPasswordRow.svelte";
  import FontsPanel from "$lib/components/settings/FontsPanel.svelte";
  import ReadAloudPanel from "$lib/components/settings/ReadAloudPanel.svelte";
  import BackupPanel from "$lib/components/settings/BackupPanel.svelte";
  import { findSection } from "$lib/components/settings/settingsSections";
  import TrashSheet from "$lib/components/layout/TrashSheet/TrashSheet.svelte";
  import { getTrashed } from "$lib/stores/entries.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import { debugPanelVisible, setDebugPanelVisible, noteLinesEnabled, setNoteLinesEnabled, noteFont } from "$lib/stores/settings.svelte";
  import { customFonts } from "$lib/stores/customFonts.svelte";
  import { fontOptions, matchOption } from "$lib/utils/fonts";
  import { breadcrumb } from "$lib/debug/log.svelte";

  const section = $derived(findSection($page.params.section ?? ""));

  let themeSheetOpen = $state(false);
  let trashOpen = $state(false);
  const trashedCount = $derived(getTrashed().length);
  // Shown on the Fonts row so the current default is visible without opening it.
  const noteFontLabel = $derived(matchOption(fontOptions(customFonts.map((f) => f.name)), noteFont.value)?.label ?? "Default");
</script>

{#if !section}
  <SettingsPage title="Settings" parent="/settings">
    <p class="missing">That settings page doesn't exist.</p>
  </SettingsPage>
{:else}
  <SettingsPage title={section.title} parent={section.parent}>
    {#if section.slug === "appearance"}
      <SettingsRow
        label="Theme"
        desc="Header & body background for the notes & todos list."
        aria-label="Open theme settings"
        onclick={() => {
          breadcrumb("settings: theme row tapped (appearance page)");
          themeSheetOpen = true;
        }}
      >
        <ThemeSwatch />
      </SettingsRow>
      <SettingsRow
        label="Fonts"
        desc="Default note font and your own imported fonts."
        value={noteFontLabel}
        chevron
        aria-label="Open fonts settings"
        onclick={() => void goto("/settings/fonts")}
      />
      <SettingsRow label="Note lines" desc="Ruled-paper lines under each line in the note editor.">
        <Switch
          checked={noteLinesEnabled.value}
          aria-label="Show note lines"
          onCheckedChange={(v) => {
            breadcrumb(`settings: note lines ${v ? "enabled" : "disabled"}`);
            setNoteLinesEnabled(v);
          }}
        />
      </SettingsRow>
      <AppThemeSheet bind:open={themeSheetOpen} onBack={() => (themeSheetOpen = false)} />
    {:else if section.slug === "fonts"}
      <FontsPanel />
    {:else if section.slug === "read-aloud"}
      <ReadAloudPanel />
    {:else if section.slug === "trash"}
      <SettingsRow
        label="Trash"
        desc="Restore something you deleted, or delete it for good."
        value={trashedCount === 0 ? "Empty" : trashedCount === 1 ? "1 item" : `${trashedCount} items`}
        chevron
        aria-label="Open trash"
        onclick={() => {
          breadcrumb("settings: trash row tapped");
          trashOpen = true;
        }}
      />
      <p class="note">Deleted items stay in Trash for 30 days, then are deleted automatically.</p>
      <TrashSheet bind:open={trashOpen} onBack={() => (trashOpen = false)} />
    {:else if section.slug === "backup"}
      <BackupPanel />
    {:else if section.slug === "privacy"}
      <AppPasswordRow />
    {:else if section.slug === "developer"}
      <SettingsRow label="Debug panel" desc="Show the on-device error/log panel while using the app.">
        <Switch
          checked={debugPanelVisible.value}
          aria-label="Show debug panel"
          onCheckedChange={(v) => {
            breadcrumb(`settings: debug panel ${v ? "enabled" : "disabled"}`);
            setDebugPanelVisible(v);
          }}
        />
      </SettingsRow>
    {/if}
  </SettingsPage>
{/if}

<style>
  .missing {
    margin: 0;
    font-size: 14px;
    color: var(--text-lo);
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
