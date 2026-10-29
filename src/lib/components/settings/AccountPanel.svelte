<script lang="ts">
  // Settings -> Account.
  //
  //   not signed in   explains the local-first deal and opens the sign-in dialog
  //   signed in       who you are, set/change a password (no email involved: it is the signed-in
  //                   person updating their own account, which also gives a Google account an
  //                   email+password login), a link to the MidManStudio accounts page, sign out
  //   not set up      this build has no Supabase settings: says so
  //
  // Signing out only ends the session on this phone. Notes, todos and boards stay here.
  import SettingsRow from "./SettingsRow.svelte";
  import SyncPanel from "./SyncPanel.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account, openPortal, setPassword, signOutNow } from "$lib/stores/account.svelte";
  import { configProblemMessage, friendlyAuthMessage } from "$lib/online/authMessages";
  import { checkPassword } from "$lib/online/passwordRules";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");
  let busy = $state<"password" | "signout" | null>(null);
  let notice = $state<{ kind: "error" | "info"; text: string } | null>(null);

  let pwOpen = $state(false);
  let pw = $state("");
  let pwConfirm = $state("");
  let showPw = $state(false);
  const rules = $derived(checkPassword(pw));
  const matches = $derived(pwConfirm !== "" && pw === pwConfirm);

  function openDialog(mode: AuthMode) {
    breadcrumb(`account: dialog opened (${mode}) from settings`);
    dialogMode = account.emailFlows ? mode : "signin";
    dialogOpen = true;
  }

  function togglePassword() {
    pwOpen = !pwOpen;
    pw = "";
    pwConfirm = "";
    showPw = false;
    notice = null;
  }

  async function savePassword() {
    if (busy) return;
    notice = null;
    if (!rules.ok) {
      notice = { kind: "error", text: "That password is too weak. Use at least 8 characters, with a capital letter and a number." };
      return;
    }
    if (!matches) {
      notice = { kind: "error", text: "The two passwords don't match." };
      return;
    }
    busy = "password";
    const r = await setPassword(pw);
    busy = null;
    if (r.ok) {
      pwOpen = false;
      pw = "";
      pwConfirm = "";
      showPw = false;
      pushToast({ title: "Password saved", description: "You can now also sign in with your email and this password." });
    } else {
      notice = { kind: "error", text: friendlyAuthMessage(r.error) };
    }
  }

  async function signOut() {
    if (busy) return;
    notice = null;
    busy = "signout";
    await signOutNow();
    busy = null;
    pwOpen = false;
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
      label="Set or change password"
      desc="So you can also sign in with your email."
      aria-label="Set or change password"
      onclick={togglePassword}
      value={pwOpen ? "Close" : ""}
      chevron={!pwOpen}
    />
    {#if pwOpen}
      <div class="pwform">
        <div class="pw">
          <input
            type={showPw ? "text" : "password"}
            aria-label="New password"
            placeholder="New password"
            autocomplete="new-password"
            autocapitalize="none"
            spellcheck="false"
            value={pw}
            oninput={(e) => (pw = e.currentTarget.value)}
          />
          <button type="button" class="toggle" aria-label={showPw ? "Hide password" : "Show password"} onclick={() => (showPw = !showPw)}>
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
        <input
          type={showPw ? "text" : "password"}
          aria-label="Confirm new password"
          placeholder="Confirm new password"
          autocomplete="new-password"
          autocapitalize="none"
          spellcheck="false"
          value={pwConfirm}
          oninput={(e) => (pwConfirm = e.currentTarget.value)}
        />
        <ul class="rules" aria-label="Password rules">
          <li class:met={rules.length}><span class="dot" aria-hidden="true"></span>At least 8 characters<span class="sr">{rules.length ? ", done" : ", not yet"}</span></li>
          <li class:met={rules.upper}><span class="dot" aria-hidden="true"></span>A capital letter<span class="sr">{rules.upper ? ", done" : ", not yet"}</span></li>
          <li class:met={rules.number}><span class="dot" aria-hidden="true"></span>A number<span class="sr">{rules.number ? ", done" : ", not yet"}</span></li>
          <li class:met={matches}><span class="dot" aria-hidden="true"></span>Both passwords match<span class="sr">{matches ? ", done" : ", not yet"}</span></li>
        </ul>
        <Button variant="default" onclick={savePassword} disabled={busy !== null} aria-label="Save password">{busy === "password" ? "Saving…" : "Save password"}</Button>
      </div>
    {/if}
    <SyncPanel />
    <SettingsRow label="Manage on MidManStudio" desc="Profile and your other studio apps." aria-label="Manage on MidManStudio" onclick={openPortal} chevron />
    {#if notice}
      <p class="notice" class:error={notice.kind === "error"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
    {/if}
    <div class="actions">
      <Button variant="outline" onclick={signOut} disabled={busy !== null} aria-label="Sign out">{busy === "signout" ? "Signing out…" : "Sign out"}</Button>
    </div>
    <p class="fine">Signing out only ends the session on this phone. Your notes, todos and boards stay here.</p>
  {:else}
    <p class="lead">You're not signed in.</p>
    <p class="fine">MidNote keeps everything on this phone. An account is only needed for the online parts: sync between devices and AI. It's your MidManStudio account, the same one the studio's other apps use.</p>
    <div class="actions">
      <Button variant="default" onclick={() => openDialog("signin")} aria-label="Sign in">Sign in</Button>
      {#if account.emailFlows}
        <Button variant="outline" onclick={() => openDialog("signup")} aria-label="Create an account">Create an account</Button>
      {/if}
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
  .pwform {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .pwform input {
    font-family: var(--font-sans);
    font-size: 16px;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    min-height: 44px;
    width: 100%;
    box-sizing: border-box;
  }
  .pw {
    position: relative;
  }
  .pw input {
    padding-right: 64px;
  }
  .toggle {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--text-lo);
    font-size: 13px;
    min-height: 36px;
    padding: 0 var(--space-3);
    cursor: pointer;
  }
  .rules {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--text-lo);
  }
  .rules li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .rules .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid var(--text-lo);
    flex-shrink: 0;
  }
  .rules li.met {
    color: var(--text-hi);
  }
  .rules li.met .dot {
    background: var(--accent);
    border-color: var(--accent);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
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
