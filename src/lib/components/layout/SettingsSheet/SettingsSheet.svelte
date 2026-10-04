<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import ThemeSectionsSheet from "$lib/components/shared/ThemeSectionsSheet/ThemeSectionsSheet.svelte";
  import FontsSheet from "$lib/components/shared/FontsSheet/FontsSheet.svelte";
  import ReadAloudSheet from "$lib/components/shared/ReadAloudSheet/ReadAloudSheet.svelte";
  import { ttsSettings } from "$lib/stores/readAloud.svelte";
  import {
    debugPanelVisible,
    setDebugPanelVisible,
    noteLinesEnabled,
    setNoteLinesEnabled,
    noteFont,
    appHeaderTheme,
    appBodyTheme,
    setAppHeaderTheme,
    setAppBodyTheme,
  } from "$lib/stores/settings.svelte";
  import { resolveTheme } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { sessionAppPassword, setSessionAppPassword } from "$lib/stores/lockSession.svelte";
  import { askPassword } from "$lib/stores/lockPrompt.svelte";
  import { entries } from "$lib/stores/entries.svelte";
  import { customFonts } from "$lib/stores/customFonts.svelte";
  import { fontOptions, matchOption } from "$lib/utils/fonts";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let themeSheetOpen = $state(false);
  let fontsSheetOpen = $state(false);
  let readAloudSheetOpen = $state(false);
  // Shown on the Read aloud row so the current speed is visible without opening it.
  const readAloudValue = $derived(`${ttsSettings.rate.toFixed(1)}×`);

  function handleOpenReadAloudSheet() {
    breadcrumb("settings: read aloud row tapped");
    // Same sequential sheet swap as the Fonts row.
    open = false;
    readAloudSheetOpen = true;
  }
  // Shown on the Fonts row so the current default is visible without opening it.
  const noteFontLabel = $derived(matchOption(fontOptions(customFonts.map((f) => f.name)), noteFont.value)?.label ?? "Default");

  function handleOpenFontsSheet() {
    breadcrumb("settings: fonts row tapped");
    // Same sequential sheet swap as the Theme row: close this Sheet, open the next.
    open = false;
    fontsSheetOpen = true;
  }
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

  // App password: there was previously no way to even see, set, or
  // forget this from anywhere except implicitly — the first time you
  // lock something with "Use app password," whatever you type just
  // becomes it for the rest of the session (see lockSession.svelte.ts's
  // header comment for why that's deliberate: it's never persisted or
  // even hashed anywhere). This surfaces that state and gives two safe
  // actions: proactively SET it (only offered when nothing is
  // currently locked with app mode — setting it then can't conflict
  // with anything real, since there's nothing yet to mismatch), and
  // FORGET it (clears it from memory, forcing the next app-locked
  // unlock to re-prompt) — deliberately no "change" action, since
  // changing it while entries already use it would silently make them
  // unopenable with the new value.
  const hasAppLockedEntries = $derived(entries.some((e) => e.encrypted && e.lockKeyMode === "app"));

  async function handleSetAppPassword() {
    breadcrumb("settings: set app password tapped");
    const p = await askPassword(
      "Set your app password",
      "Used for every note/todo you lock with \u201cUse app password.\u201d Remembered only until you close the app.",
      true,
    );
    if (p) setSessionAppPassword(p);
  }

  function handleForgetAppPassword() {
    breadcrumb("settings: forget app password tapped");
    setSessionAppPassword(null);
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
    <button class="settings-row settings-row-button" onclick={handleOpenFontsSheet} aria-label="Open fonts settings">
      <div class="row-text">
        <span class="row-label">Fonts</span>
        <span class="row-desc">Default note font and your own imported fonts.</span>
      </div>
      <span class="row-value">{noteFontLabel}</span>
    </button>
    <button class="settings-row settings-row-button" onclick={handleOpenReadAloudSheet} aria-label="Open read aloud settings">
      <div class="row-text">
        <span class="row-label">Read aloud</span>
        <span class="row-desc">Voice, speed and pitch for having notes read to you.</span>
      </div>
      <span class="row-value">{readAloudValue}</span>
    </button>
    <div class="settings-row">
      <div class="row-text">
        <span class="row-label">App password</span>
        <span class="row-desc">
          {#if sessionAppPassword.value}
            Set for this session — used automatically for anything locked with "Use app password."
          {:else if hasAppLockedEntries}
            Not set this session yet — you'll be asked for it the next time you open something locked with it.
          {:else}
            Not set yet — set it now, or it'll be asked for the first time you lock something with "Use app password."
          {/if}
        </span>
      </div>
      {#if sessionAppPassword.value}
        <button class="text-action" onclick={handleForgetAppPassword}>Forget</button>
      {:else if !hasAppLockedEntries}
        <button class="text-action" onclick={handleSetAppPassword}>Set</button>
      {/if}
    </div>
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

<FontsSheet bind:open={fontsSheetOpen} />
<ReadAloudSheet bind:open={readAloudSheetOpen} />

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
  headerDescription="The top bar — menu, title, and sync icon."
  bodyDescription="Everything else — tabs, tags, and your notes list."
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
  .row-value {
    flex-shrink: 0;
    font-size: 13px;
    color: var(--text-lo);
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
  .text-action {
    flex-shrink: 0;
    background: transparent;
    border: none;
    padding: var(--space-1) var(--space-2);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
