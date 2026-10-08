<script lang="ts">
  // Round 42 — the Settings PANEL now holds only the basics. Everything else
  // (fonts, read aloud, app password, debug panel, ...) lives on the Advanced
  // settings page (/settings), reached from the last row. See
  // components/settings/settingsSections.ts for the whole map.
  import { goto } from "$app/navigation";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import ThemeSwatch from "$lib/components/settings/ThemeSwatch.svelte";
  import AppThemeSheet from "$lib/components/settings/AppThemeSheet.svelte";
  import { noteLinesEnabled, setNoteLinesEnabled } from "$lib/stores/settings.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let { open = $bindable(false), onBack }: { open?: boolean; onBack?: () => void } = $props();

  let themeSheetOpen = $state(false);

  function handleOpenThemeSheet() {
    breadcrumb("settings: theme row tapped");
    // Sequential sheet swap — Sheet.svelte doesn't support stacking: close this
    // one, open the next. The theme sheet's Back arrow reopens this panel.
    open = false;
    themeSheetOpen = true;
  }

  function themeBack() {
    themeSheetOpen = false;
    open = true;
  }

  function handleOpenAdvanced() {
    breadcrumb("settings: advanced settings tapped");
    open = false;
    void goto("/settings");
  }
</script>

<Sheet bind:open side="left" title="Settings" {onBack}>
  <div class="settings-list">
    <SettingsRow label="Theme" desc="Header & body background for the notes & todos list." aria-label="Open theme settings" onclick={handleOpenThemeSheet}>
      <ThemeSwatch />
    </SettingsRow>
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
    <SettingsRow
      label="Advanced settings"
      desc="Fonts, read aloud, app password and more."
      chevron
      aria-label="Open advanced settings"
      onclick={handleOpenAdvanced}
    />
  </div>
</Sheet>

<AppThemeSheet bind:open={themeSheetOpen} onBack={themeBack} />

<style>
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
