<script lang="ts">
  // Round 42 — the landing page's Theme sheet, in one place so the Settings panel
  // and Settings -> Appearance open the exact same thing.
  //
  // No icon/onIconChange passed — the landing page has no icon slot, see
  // entry.ts's `icon` comment. ThemeSectionsSheet hides that row entirely when
  // the prop is simply omitted like this.
  import ThemeSectionsSheet from "$lib/components/shared/ThemeSectionsSheet/ThemeSectionsSheet.svelte";
  import { appHeaderTheme, appBodyTheme, setAppHeaderTheme, setAppBodyTheme } from "$lib/stores/settings.svelte";

  let { open = $bindable(false), onBack }: { open?: boolean; onBack?: () => void } = $props();
</script>

<ThemeSectionsSheet
  bind:open
  {onBack}
  title="Landing page theme"
  headerTheme={appHeaderTheme.value}
  bodyTheme={appBodyTheme.value}
  onHeaderChange={setAppHeaderTheme}
  onBodyChange={setAppBodyTheme}
  bodyAllowCustom={true}
  headerDescription="The top bar — menu, title, and sync icon."
  bodyDescription="Everything else — tabs, tags, and your notes list."
/>
