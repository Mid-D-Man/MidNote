<script lang="ts">
  // Round 42 — the App password row (moved out of the Settings panel into
  // Settings -> Privacy & security; logic unchanged).
  //
  // The app password is never persisted or even hashed anywhere (see
  // lockSession.svelte.ts's header comment): the first time you lock something
  // with "Use app password", what you type becomes it. It is only REMEMBERED in
  // memory, and only for a while: the row below ("Ask for password again") sets how
  // long, and utils/autoLock.ts forgets it. This shows that state and offers two
  // safe actions: SET it (only when nothing is currently locked with app mode —
  // nothing yet to mismatch) and FORGET it (clears it from memory and re-locks
  // anything open, so the next app-locked unlock asks again). Deliberately no
  // "change": changing it while entries already use it would silently make them
  // unopenable with the new value.
  import SettingsRow from "./SettingsRow.svelte";
  import { sessionAppPassword, setSessionAppPassword, heldAppPassword } from "$lib/stores/lockSession.svelte";
  import { askPassword } from "$lib/stores/lockPrompt.svelte";
  import { entries } from "$lib/stores/entries.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { lockNow } from "$lib/utils/lockFlow";

  const hasAppLockedEntries = $derived(entries.some((e) => e.encrypted && e.lockKeyMode === "app"));

  async function handleSetAppPassword() {
    breadcrumb("settings: set app password tapped");
    const p = await askPassword(
      "Set your app password",
      "Used for everything you lock with \u201cUse app password.\u201d",
      true,
    );
    if (p) setSessionAppPassword(p);
  }

  function handleForgetAppPassword() {
    breadcrumb("settings: forget app password tapped");
    void lockNow();
  }

  const desc = $derived(
    sessionAppPassword.value
      ? 'Remembered for now. Tap Forget to ask again.'
      : heldAppPassword.present
        ? 'Remembered. Your phone confirms it\'s you to use it.'
        : hasAppLockedEntries
        ? "You'll be asked for it when you open something locked."
        : 'Not set yet. Set it now, or you\'ll be asked when you first lock something.',
  );
</script>

<SettingsRow label="App password" {desc}>
  {#if sessionAppPassword.value || heldAppPassword.present}
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
