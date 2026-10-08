<script lang="ts">
  // Round 42 — the App password row (moved out of the Settings panel into
  // Settings -> Privacy & security; logic unchanged).
  //
  // The app password is never persisted or even hashed anywhere (see
  // lockSession.svelte.ts's header comment): the first time you lock something
  // with "Use app password", whatever you type just becomes it for the rest of
  // the session. This shows that state and offers two safe actions: SET it
  // (only when nothing is currently locked with app mode — nothing yet to
  // mismatch) and FORGET it (clears it from memory, so the next app-locked
  // unlock asks again). Deliberately no "change": changing it while entries
  // already use it would silently make them unopenable with the new value.
  import SettingsRow from "./SettingsRow.svelte";
  import { sessionAppPassword, setSessionAppPassword } from "$lib/stores/lockSession.svelte";
  import { askPassword } from "$lib/stores/lockPrompt.svelte";
  import { entries } from "$lib/stores/entries.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

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

  const desc = $derived(
    sessionAppPassword.value
      ? 'Set for this session — used automatically for anything locked with "Use app password."'
      : hasAppLockedEntries
        ? "Not set this session yet — you'll be asked for it the next time you open something locked with it."
        : 'Not set yet — set it now, or it\'ll be asked for the first time you lock something with "Use app password."',
  );
</script>

<SettingsRow label="App password" {desc}>
  {#if sessionAppPassword.value}
    <button type="button" class="text-action" onclick={handleForgetAppPassword}>Forget</button>
  {:else if !hasAppLockedEntries}
    <button type="button" class="text-action" onclick={handleSetAppPassword}>Set</button>
  {/if}
</SettingsRow>

<style>
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
