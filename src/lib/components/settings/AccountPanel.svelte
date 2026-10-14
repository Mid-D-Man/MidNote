<script lang="ts">
  // Round B — Settings -> Account.
  //
  //   not signed in   explains the local-first deal and opens the sign-in / sign-up dialog
  //   signed in       who you are, change password (emails a reset link), sign out
  //   not set up      this build has no Supabase settings: says so
  //
  // Signing out only ends the session on this phone. Notes, todos and boards stay here.
  import SettingsRow from "./SettingsRow.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account, sendPasswordReset, signOutNow } from "$lib/stores/account.svelte";
  import { configProblemMessage, friendlyAuthMessage } from "$lib/online/authMessages";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");
  let busy = $state<"reset" | "signout" | null>(null);
  let notice = $state<{ kind: "error" | "info"; text: string } | null>(null);

  function openDialog(mode: AuthMode) {
    breadcrumb(`account: dialog opened (${mode}) from settings`);
    dialogMode = mode;
    dialogOpen = true;
  }

  async function changePassword() {
    if (!account.email || busy) return;
    notice = null;
    busy = "reset";
    const r = await sendPasswordReset(account.email);
    busy = null;
    notice = r.ok
      ? { kind: "info", text: `We emailed a reset link to ${account.email}. It opens the MidManStudio accounts page, where you choose a new password.` }
      : { kind: "error", text: friendlyAuthMessage(r.error) };
  }

  async function signOut() {
    if (busy) return;
    notice = null;
    busy = "signout";
    await signOutNow();
    busy = null;
    pushToast({ title: "Signed out", description: "Your notes are still on this phone." });
  }
</script>

<div class="account">
  {#if !account.configured}
    <p class="lead">Online features aren't available in this build.</p>
    <p class="fine">{configProblemMessage(account.problem ?? "missing")} MidNote works fully without an account.</p>
  {:else if account.signedIn}
    <SettingsRow label="Signed in" desc={account.email ?? ""} />
    <SettingsRow
      label="Change password"
      desc="We'll email you a link."
      aria-label="Change password"
      onclick={changePassword}
      value={busy === "reset" ? "Sending…" : ""}
      chevron={busy !== "reset"}
    />
    {#if notice}
      <p class="notice" class:error={notice.kind === "error"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
    {/if}
    <div class="actions">
      <Button variant="outline" onclick={signOut} disabled={busy !== null} aria-label="Sign out">{busy === "signout" ? "Signing out…" : "Sign out"}</Button>
    </div>
    <p class="fine">Signing out only ends the session on this phone. Your notes, todos and boards stay here.</p>
  {:else}
    <p class="lead">You're not signed in.</p>
    <p class="fine">MidNote keeps everything on this phone. An account is only needed for the online parts that are coming: sync between devices and AI. It's your MidManStudio account, the same one the studio's other apps use.</p>
    <div class="actions">
      <Button variant="default" onclick={() => openDialog("signin")} aria-label="Sign in">Sign in</Button>
      <Button variant="outline" onclick={() => openDialog("signup")} aria-label="Create an account">Create an account</Button>
    </div>
  {/if}
</div>

<AuthDialog bind:open={dialogOpen} bind:mode={dialogMode} />

<style>
  .account {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .lead {
    margin: 0;
    font-size: 15px;
    color: var(--text-hi);
  }
  .fine {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-lo);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .notice {
    margin: 0;
    padding: var(--space-3);
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .notice.error {
    color: var(--danger);
    background: var(--danger-wash);
    border-color: var(--danger);
  }
</style>
