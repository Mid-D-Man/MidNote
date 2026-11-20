<script lang="ts">
  // Settings -> Privacy & security: "Ask for password again" — how long the app may be
  // away (background / screen off) before locked notes need the password again. The
  // app also asks after 5 minutes with no touch while it is in front, and when you tap
  // Forget on the App password row. The choice is per phone (never synced); the rules
  // and the default live in utils/autoLockPolicy.ts, the forgetting in utils/autoLock.ts.
  import SettingsRow from "./SettingsRow.svelte";
  import { autoLockAway, setAutoLockAway } from "$lib/stores/lockSession.svelte";
  import { AWAY_OPTIONS, normalizeAway } from "$lib/utils/autoLockPolicy";
  import { breadcrumb } from "$lib/debug/log.svelte";

  function handleChange(e: Event) {
    const choice = normalizeAway((e.currentTarget as HTMLSelectElement).value);
    breadcrumb(`settings: ask for password again -> ${choice}`);
    setAutoLockAway(choice);
  }
</script>

<SettingsRow
  label="Ask for password again"
  desc="How long you can be away before locked notes ask for the password again."
>
  <select class="away" aria-label="Ask for password again" value={autoLockAway.value} onchange={handleChange}>
    {#each AWAY_OPTIONS as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</SettingsRow>

<style>
  .away {
    flex-shrink: 0;
    max-width: 150px;
    height: 40px;
    padding: 0 var(--space-2);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 13px;
  }
</style>
