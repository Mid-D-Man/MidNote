<script lang="ts">
  // Settings -> Privacy & security -> "Unlock with phone security".
  //
  // OFF by default and only shown where the phone's security prompt exists (the Android app). Turning it ON first asks the phone
  // once, so it is only ever on if it works. With it on, going away no longer makes the app forget the app password: it is held,
  // and opening a locked note asks the phone (fingerprint, face, or the PIN / pattern / password of the phone) instead of the
  // keyboard. Cancelling or failing falls back to typing the password. Notes locked with their own password still need typing.
  // The setting is per phone (never synced). State is written from handlers and onMount only.
  import { onMount } from "svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import { phoneUnlock, setPhoneUnlock } from "$lib/stores/lockSession.svelte";
  import { getPhoneAuth, confirmItsYou } from "$lib/utils/phoneAuth";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let supported = $state(false);
  let busy = $state(false);
  let on = $state(phoneUnlock.on);

  onMount(() => {
    getPhoneAuth()
      .supported()
      .then((v) => (supported = v))
      .catch(() => (supported = false));
  });

  async function change(wanted: boolean) {
    breadcrumb(`settings: phone unlock ${wanted ? "on" : "off"} tapped`);
    if (!wanted) {
      setPhoneUnlock(false);
      return;
    }
    busy = true;
    const r = await confirmItsYou("Turn on phone unlock");
    busy = false;
    if (r.ok) {
      setPhoneUnlock(true);
      on = true;
      return;
    }
    on = false;
    if (r.why === "no-lock") pushToast({ title: "Set a screen lock first", description: "Add a PIN, pattern, password or fingerprint in your phone's settings.", variant: "destructive" });
    else if (r.why !== "cancelled") pushToast({ title: "Couldn't confirm it's you", variant: "destructive" });
  }
</script>

{#if supported}
  <SettingsRow label="Unlock with phone security" desc="Open locked notes with your fingerprint, face or phone PIN.">
    <Switch bind:checked={on} disabled={busy} aria-label="Unlock with phone security" onCheckedChange={(v) => void change(v)} />
  </SettingsRow>
{/if}
