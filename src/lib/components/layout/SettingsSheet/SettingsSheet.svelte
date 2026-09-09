<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import ThemeSectionsSheet from "$lib/components/shared/ThemeSectionsSheet/ThemeSectionsSheet.svelte";
  import {
    debugPanelVisible,
    setDebugPanelVisible,
    noteLinesEnabled,
    setNoteLinesEnabled,
    appHeaderTheme,
    appBodyTheme,
    setAppHeaderTheme,
    setAppBodyTheme,
  } from "$lib/stores/settings.svelte";
  import { resolveTheme } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let themeSheetOpen = $state(false);
  // Swatch preview on this row shows the HEADER slot specifically — it's
  // the one visible everywhere at a glance (the tab bar), while body is
  // the scrollable area behind the list. Both are still editable once
  // the sheet opens; this preview is just which one gets a shorthand
  // glance from the settings list itself, same as before the split.
  const resolvedAppTheme = $derived(resolveTheme(appHeaderTheme.value, customThemes));

  function handleOpenThemeSheet() {
    breadcrumb("settings: theme row tapped");
    // Sequential sheet swap — same reasoning as NoteEditorHeader/
    // TodoHeader's Theme row: close this Sheet, open the next.
    open = false;
    themeSheetOpen = true;
  }
</script>

<Sheet bind:open side="left" title="Settings">
  <div class="settings-list">
    <button class="settings-row settings-row-button" onclick={handleOpenThemeSheet}>
      <div class="row-text">
        <span class="row-label">Theme</span>
        <span class="row-desc">Header &amp; body background for the notes &amp; todos list.</span>
      </div>
      <span
        class="theme-swatch"
        class:none-swatch={resolvedAppTheme.kind === "none"}
        style={resolvedAppTheme.kind === "color"
          ? `background:${resolvedAppTheme.color}`
          : resolvedAppTheme.kind === "image"
            ? `background-image:url(${resolvedAppTheme.dataUrl})`
            : undefined}
        aria-hidden="true"
      ></span>
    </button>
    <div class="settings-row">
      <div class="row-text">
        <span class="row-label">Debug panel</span>
        <span class="row-desc">Show the on-device error/log panel while using the app.</span>
      </div>
      <Switch
        checked={debugPanelVisible.value}
        aria-label="Show debug panel"
        onCheckedChange={(v) => {
          breadcrumb(`settings: debug panel ${v ? "enabled" : "disabled"}`);
          setDebugPanelVisible(v);
        }}
      />
    </div>
    <div class="settings-row">
      <div class="row-text">
        <span class="row-label">Note lines</span>
        <span class="row-desc">Ruled-paper lines under each line in the note editor.</span>
      </div>
      <Switch
        checked={noteLinesEnabled.value}
        aria-label="Show note lines"
        onCheckedChange={(v) => {
          breadcrumb(`settings: note lines ${v ? "enabled" : "disabled"}`);
          setNoteLinesEnabled(v);
        }}
      />
    </div>
  </div>
</Sheet>

<!-- No icon/onIconChange passed — the landing page has no icon slot,
     see entry.ts's `icon` comment. ThemeSectionsSheet hides that row
     entirely when the prop is simply omitted like this. -->
<ThemeSectionsSheet
  bind:open={themeSheetOpen}
  title="Landing page theme"
  headerTheme={appHeaderTheme.value}
  bodyTheme={appBodyTheme.value}
  onHeaderChange={setAppHeaderTheme}
  onBodyChange={setAppBodyTheme}
  bodyAllowCustom={true}
/>

<style>
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-hi);
  }
  .row-desc {
    font-size: 12px;
    color: var(--text-faint);
  }
  .settings-row-button {
    background: transparent;
    border: none;
    padding: 0;
    width: 100%;
    text-align: left;
    cursor: pointer;
  }
  .theme-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background-color: var(--surface);
    background-size: cover;
    background-position: center;
    flex-shrink: 0;
  }
  .theme-swatch.none-swatch {
    background: linear-gradient(45deg, transparent 47%, var(--text-faint) 47%, var(--text-faint) 53%, transparent 53%), var(--surface);
  }
</style>
