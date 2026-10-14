<script lang="ts" module>
  export type AuthMode = "signin" | "signup" | "check-email" | "forgot" | "forgot-sent";
</script>

<script lang="ts">
  // Round B — sign in / create account / forgot password.
  //
  //   signin        email + password
  //   signup        email + password; the project REQUIRES email confirmation, so success
  //                 lands on "check-email" (not signed in yet)
  //   check-email   "we sent a link" + resend. Neutral on purpose: it reads the same whether
  //                 the address is new or already has an account (the server doesn't say).
  //   forgot        email -> reset link
  //   forgot-sent   neutral "if that address has an account..."
  //
  // The confirmation and reset links open the MidManStudio accounts page (the project's Site
  // URL), where the person finishes; they then come back here and sign in.
  //
  // With no Supabase settings in the build (dev, tests, a build missing its secrets) the
  // dialog says so plainly instead of pretending.
  import { pushToast } from "$lib/stores/toast.svelte";
  import { account, resendConfirmation, sendPasswordReset, signInWith, signUpWith } from "$lib/stores/account.svelte";
  import { configProblemMessage, friendlyAuthMessage } from "$lib/online/authMessages";

  let { open = $bindable(false), mode = $bindable<AuthMode>("signin") }: { open?: boolean; mode?: AuthMode } = $props();

  let email = $state("");
  let password = $state("");
  let showPassword = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Sign-in failed because the email isn't confirmed yet: offer to resend the link. */
  let unconfirmed = $state(false);
  let resent = $state(false);

  function close() {
    open = false;
    password = "";
    showPassword = false;
    error = null;
    busy = false;
    unconfirmed = false;
    resent = false;
  }

  function go(next: AuthMode) {
    mode = next;
    error = null;
    unconfirmed = false;
    resent = false;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    error = null;
    unconfirmed = false;
    busy = true;
    try {
      if (mode === "signin") {
        const r = await signInWith(email, password);
        if (r.ok) {
          pushToast({ title: "Signed in", description: account.email ?? undefined });
          close();
        } else {
          error = friendlyAuthMessage(r.error);
          unconfirmed = r.error.kind === "email-not-confirmed";
        }
      } else if (mode === "signup") {
        const r = await signUpWith(email, password);
        if (!r.ok) {
          error = friendlyAuthMessage(r.error);
        } else if (r.signedIn) {
          pushToast({ title: "Account created", description: account.email ?? undefined });
          close();
        } else {
          password = "";
          go("check-email");
        }
      } else if (mode === "forgot") {
        const r = await sendPasswordReset(email);
        if (r.ok) go("forgot-sent");
        else error = friendlyAuthMessage(r.error);
      }
    } finally {
      busy = false;
    }
  }

  async function resend() {
    if (busy) return;
    error = null;
    busy = true;
    try {
      const r = await resendConfirmation(email);
      if (r.ok) resent = true;
      else error = friendlyAuthMessage(r.error);
    } finally {
      busy = false;
    }
  }

  const title = $derived(
    mode === "signup" ? "Create account" : mode === "check-email" ? "Check your email" : mode === "forgot" || mode === "forgot-sent" ? "Reset password" : "Sign in",
  );
</script>

{#if open}
  <div class="scrim" onclick={close} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    {#if !account.configured}
      <h2 id="auth-title">Online features</h2>
      <p class="note">{configProblemMessage(account.problem ?? "missing")}</p>
      <p class="note subtle">MidNote works fully without an account. Sign-in is only for sync and AI.</p>
      <button type="button" class="primary" aria-label="Close" onclick={close}>Close</button>
    {:else if account.signedIn}
      <h2 id="auth-title">Signed in</h2>
      <p class="note">{account.email}</p>
      <button type="button" class="primary" aria-label="Close" onclick={close}>Close</button>
    {:else}
      <h2 id="auth-title">{title}</h2>

      {#if mode === "signin" || mode === "signup"}
        <div class="tabs">
          <button type="button" class:active={mode === "signin"} aria-pressed={mode === "signin"} onclick={() => go("signin")}>Sign in</button>
          <button type="button" class:active={mode === "signup"} aria-pressed={mode === "signup"} onclick={() => go("signup")}>Create account</button>
        </div>
      {/if}

      {#if mode === "check-email"}
        <p class="note">If <strong>{email.trim()}</strong> is new, we've sent it a confirmation link. Open the link, then come back here and sign in.</p>
        <p class="note subtle">Nothing arrived? Check spam, or send it again. If you already have an account, just sign in.</p>
        {#if error}<p class="err" role="alert">{error}</p>{/if}
        {#if resent}<p class="ok" role="status">Sent again.</p>{/if}
        <button type="button" class="secondary" aria-label="Resend email" disabled={busy || resent} onclick={resend}>{resent ? "Sent" : "Resend email"}</button>
        <button type="button" class="primary" aria-label="Go to sign in" onclick={() => go("signin")}>Go to sign in</button>
      {:else if mode === "forgot-sent"}
        <p class="note">If <strong>{email.trim()}</strong> has an account, a reset link is on its way. It opens the MidManStudio accounts page, where you choose a new password.</p>
        <button type="button" class="primary" aria-label="Back to sign in" onclick={() => go("signin")}>Back to sign in</button>
      {:else}
        <form onsubmit={submit}>
          <input
            type="email"
            aria-label="Email"
            placeholder="Email"
            autocomplete="email"
            autocapitalize="none"
            spellcheck="false"
            inputmode="email"
            required
            value={email}
            oninput={(e) => (email = e.currentTarget.value)}
          />
          {#if mode !== "forgot"}
            <div class="pw">
              <input
                type={showPassword ? "text" : "password"}
                aria-label="Password"
                placeholder="Password"
                autocomplete={mode === "signup" ? "new-password" : "current-password"}
                autocapitalize="none"
                spellcheck="false"
                required
                value={password}
                oninput={(e) => (password = e.currentTarget.value)}
              />
              <button type="button" class="toggle" aria-label={showPassword ? "Hide password" : "Show password"} onclick={() => (showPassword = !showPassword)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          {/if}
          {#if mode === "signup"}
            <p class="hint">At least 6 characters. A longer one is better.</p>
          {/if}
          {#if error}<p class="err" role="alert">{error}</p>{/if}
          {#if unconfirmed}
            {#if resent}
              <p class="ok" role="status">Confirmation email sent again.</p>
            {:else}
              <button type="button" class="link" aria-label="Resend confirmation email" disabled={busy} onclick={resend}>Resend confirmation email</button>
            {/if}
          {/if}
          <button type="submit" class="primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
          </button>
        </form>
        {#if mode === "signin"}
          <button type="button" class="link" aria-label="Forgot password" onclick={() => go("forgot")}>Forgot password?</button>
        {:else if mode === "forgot"}
          <button type="button" class="link" aria-label="Back to sign in" onclick={() => go("signin")}>Back to sign in</button>
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 16, 0.6);
    z-index: 60;
  }
  .dialog {
    position: fixed;
    top: max(10vh, calc(env(safe-area-inset-top, 0px) + 12px));
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    width: min(340px, 90vw);
    max-height: 86dvh;
    overflow-y: auto;
    z-index: 70;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h2 {
    font-family: var(--font-display);
    font-size: 17px;
    margin: 0;
    color: var(--text-hi);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  input {
    font-family: var(--font-sans);
    font-size: 16px; /* 16px stops Android/iOS from zooming the page on focus */
    color: var(--text-hi);
    background: var(--surface);
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
  .tabs {
    display: flex;
    gap: var(--space-1);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 2px;
  }
  .tabs button {
    flex: 1;
    min-height: 36px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    font-size: 14px;
    cursor: pointer;
  }
  .tabs button.active {
    background: var(--accent);
    color: var(--bg);
    font-weight: 500;
  }
  .primary {
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    min-height: 44px;
    padding: var(--space-2);
    font-weight: 500;
    cursor: pointer;
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .secondary {
    background: transparent;
    color: var(--text-hi);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    min-height: 44px;
    padding: var(--space-2);
    cursor: pointer;
  }
  .link {
    background: transparent;
    border: none;
    color: var(--accent);
    font-size: 14px;
    min-height: 36px;
    padding: 0;
    cursor: pointer;
    text-align: center;
  }
  .note,
  .hint,
  .err,
  .ok {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--text-hi);
  }
  .subtle,
  .hint {
    color: var(--text-lo);
    font-size: 13px;
  }
  .err {
    color: var(--danger);
  }
  .ok {
    color: var(--text-lo);
  }
</style>
