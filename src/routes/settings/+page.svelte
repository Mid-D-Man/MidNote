<script lang="ts">
  // Round 42 — Advanced settings: the main categories. Each one opens its own
  // page (/settings/<slug>); Back from here returns to the notes list.
  import { goto } from "$app/navigation";
  import SettingsPage from "$lib/components/settings/SettingsPage.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import { SETTINGS_SECTIONS } from "$lib/components/settings/settingsSections";

  const categories = SETTINGS_SECTIONS.filter((s) => s.main);
</script>

<SettingsPage title="Advanced settings" parent="/">
  {#each categories as s (s.slug)}
    <SettingsRow label={s.title} desc={s.desc} chevron aria-label={`Open ${s.title} settings`} onclick={() => void goto(`/settings/${s.slug}`)} />
  {/each}
</SettingsPage>
