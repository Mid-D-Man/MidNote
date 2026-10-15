<script lang="ts" module>
  export type AuthMode = "signin" | "signup" | "check-email" | "forgot" | "forgot-sent";
</script>

<script lang="ts">
  // Round B — sign in / create account / forgot password.
  //
  //   signin        email + password
  //   signup        name + email + password typed twice, with the password rules shown live (the
  //                 name becomes the shared studio profile's display name, like the accounts
  //                 portal's own sign-up); the project REQUIRES email confirmation, so success
  //                 lands on "check-email" (not signed in yet)
  //   check-email   "we sent a link" + resend. Neutral on purpose: it reads the same whether
  //                 the address is new or already has an account (the server doesn't say).
  //   forgot        email -> reset link
  //   forgot-sent   neutral "if that address has an account..."
  //
  // "Continue with Google" (both tabs) opens the browser; Google and Supabase send the person back
  // to the app through the midnote://auth deep link, which signs them in (see account.svelte.ts).
  // Google has already verified the email, so there is no confirmation email on that path.
  //
  // The confirmation and reset links open the MidManStudio accounts page (the project's Site
  // URL), where the person finishes; they then come back here and sign in.
  //
  // With no Supabase settings in the build (dev, tests, a build missing its secrets) the
  // dialog says so plainly instead of pretending.
  import { pushToast } from "$lib/stores/toast.svelte";
  import { account, cancelGoogle, resendConfirmation, sendPasswordReset, signInWith, signInWithGoogle, signUpWith } from "$lib/stores/account.svelte";
  import { configProblemMessage, friendlyAuthMessage } from "$lib/online/authMessages";
  import { AuthError } from "$lib/online/authClient";
  import { checkPassword } from "$lib/online/passwordRules";

  let { open = $bindable(false), mode = $bindable<AuthMode>("signin") }: { open?: boolean; mode?: AuthMode } = $props();

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let confirm = $state("");
  let showPassword = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Sign-in failed because the email isn't confirmed yet: offer to resend the link. */
  let unconfirmed = $state(false);
  let resent = $state(false);

  function close() {
    open = false;
    password = "";
    confirm = "";
    showPassword = false;
    error = null;
    busy = false;
    unconfirmed = false;
    resent = false;
  }

  function go(next: AuthMode) {
    mode = next;
    error = null;
    account.oauthMessage = null;
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
        if (!rules.ok) {
          error = friendlyAuthMessage(new AuthError("weak-password", "Password doesn't meet the rules"));
          return;
        }
        if (password !== confirm) {
          error = "The two passwords don't match.";
          return;
        }
        const r = await signUpWith(email, password, name);
        if (!r.ok) {
          error = friendlyAuthMessage(r.error);
        } else if (r.signedIn) {
          pushToast({ title: "Account created", description: account.email ?? undefined });
          close();
        } else {
          password = "";
          confirm = "";
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

  async function google() {
    if (busy) return;
    error = null;
    busy = true;
    try {
      const r = await signInWithGoogle();
      if (!r.ok) error = friendlyAuthMessage(r.error);
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

  const rules = $derived(checkPassword(password));
  /** A problem from this form, or from a Google sign-in that came back from the browser. */
  const shownError = $derived(error ?? account.oauthMessage);

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

      {#if mode === "signin" || mode === "signup"}
        {#if account.oauthPending}
          <p class="note">Finish signing in with Google in your browser, then come back to MidNote.</p>
          <button type="button" class="secondary" aria-label="Cancel Google sign-in" onclick={cancelGoogle}>Cancel</button>
        {:else}
          <button type="button" class="google" aria-label="Continue with Google" disabled={busy} onclick={google}>
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>
        {/if}
        <div class="or" role="separator"><span>or use email</span></div>
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
          {#if mode === "signup"}
            <input
              type="text"
              aria-label="Name"
              placeholder="Your name"
              autocomplete="name"
              maxlength="80"
              required
              value={name}
              oninput={(e) => (name = e.currentTarget.value)}
            />
          {/if}
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
            <input
              type={showPassword ? "text" : "password"}
              aria-label="Confirm password"
              placeholder="Confirm password"
              autocomplete="new-password"
              autocapitalize="none"
              spellcheck="false"
              required
              value={confirm}
              oninput={(e) => (confirm = e.currentTarget.value)}
            />
            <ul class="rules" aria-label="Password rules">
              <li class:met={rules.length}><span class="dot" aria-hidden="true"></span>At least 8 characters<span class="sr">{rules.length ? ", done" : ", not yet"}</span></li>
              <li class:met={rules.upper}><span class="dot" aria-hidden="true"></span>A capital letter<span class="sr">{rules.upper ? ", done" : ", not yet"}</span></li>
              <li class:met={rules.number}><span class="dot" aria-hidden="true"></span>A number<span class="sr">{rules.number ? ", done" : ", not yet"}</span></li>
              <li class:met={confirm !== "" && password === confirm}><span class="dot" aria-hidden="true"></span>Both passwords match<span class="sr">{confirm !== "" && password === confirm ? ", done" : ", not yet"}</span></li>
            </ul>
          {/if}
          {#if shownError}<p class="err" role="alert">{shownError}</p>{/if}
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
  .google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: var(--surface);
    color: var(--text-hi);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    min-height: 44px;
    padding: var(--space-2);
    font-size: 14px;
    cursor: pointer;
  }
  .google:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .or {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text-lo);
    font-size: 12px;
  }
  .or::before,
  .or::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--hairline);
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
  .note,
  .err,
  .ok {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--text-hi);
  }
  .subtle {
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
