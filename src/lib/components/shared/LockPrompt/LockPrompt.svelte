<script lang="ts">
  // Mounted once in +layout.svelte (see Toast.svelte for the identical
  // pattern) — reads lockPromptRequest and renders whichever step is
  // currently active. Callers never import this component directly;
  // they call askLockChoice()/askPassword() from lockPrompt.svelte.ts
  // and await the result.
  import { lockPromptRequest } from "$lib/stores/lockPrompt.svelte";

  let password = $state("");
  let confirmPassword = $state("");
  let localError = $state<string | null>(null);

  // Reset the input fields fresh each time a NEW password-step request
  // comes in (not on every reactive re-render) — keyed on object
  // identity via a plain variable rather than $effect, since this only
  // ever needs to happen once per request, not track ongoing changes.
  let lastSeenRequest: unknown = null;
  $effect(() => {
    if (lockPromptRequest.value !== lastSeenRequest) {
      lastSeenRequest = lockPromptRequest.value;
      password = "";
      confirmPassword = "";
      localError = null;
    }
  });

  function submitPassword() {
    const req = lockPromptRequest.value;
    if (!req || req.kind !== "password") return;
    if (password.length === 0) {
      localError = "Enter a password.";
      return;
    }
    if (req.confirm && password !== confirmPassword) {
      localError = "Passwords don't match.";
      return;
    }
    req.resolve(password);
  }

  function handlePasswordKeydown(e: KeyboardEvent) {
    const req = lockPromptRequest.value;
    if (e.key === "Enter" && req?.kind === "password" && !req.confirm) submitPassword();
  }

  let passwordInputEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (lockPromptRequest.value?.kind === "password") passwordInputEl?.focus();
  });

  function cancel() {
    const req = lockPromptRequest.value;
    if (!req) return;
    if (req.kind === "choice") req.resolve(null);
    else req.resolve(null);
  }

  function chooseApp() {
    const req = lockPromptRequest.value;
    if (req?.kind === "choice") req.resolve("app");
  }
  function chooseCustom() {
    const req = lockPromptRequest.value;
    if (req?.kind === "choice") req.resolve("custom");
  }
</script>

{#if lockPromptRequest.value}
  <div class="scrim" onclick={cancel} role="presentation"></div>
  <div class="dialog" role="alertdialog" aria-modal="true">
    {#if lockPromptRequest.value.kind === "choice"}
      <h2>Lock with which password?</h2>
      <p>Your app password unlocks everything locked this way in one go. A custom password is just for this note or todo.</p>
      <div class="choice-actions">
        <button class="choice-btn" onclick={chooseApp}>Use app password</button>
        <button class="choice-btn" onclick={chooseCustom}>Set custom password</button>
      </div>
      <button class="cancel-link" onclick={cancel}>Cancel</button>
    {:else}
      <h2>{lockPromptRequest.value.title}</h2>
      {#if lockPromptRequest.value.description}
        <p>{lockPromptRequest.value.description}</p>
      {/if}
      {#if lockPromptRequest.value.error || localError}
        <p class="error">{lockPromptRequest.value.error ?? localError}</p>
      {/if}
      <input
        type="password"
        placeholder="Password"
        bind:value={password}
        bind:this={passwordInputEl}
        onkeydown={handlePasswordKeydown}
      />
      {#if lockPromptRequest.value.confirm}
        <input
          type="password"
          placeholder="Confirm password"
          bind:value={confirmPassword}
          onkeydown={(e) => e.key === "Enter" && submitPassword()}
        />
      {/if}
      <div class="actions">
        <button class="cancel" onclick={cancel}>Cancel</button>
        <button class="confirm" onclick={submitPassword}>Continue</button>
      </div>
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
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    width: min(360px, 88vw);
    z-index: 70;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h2 {
    font-family: var(--font-display);
    font-size: 17px;
    margin: 0;
  }
  p {
    font-size: 13px;
    color: var(--text-lo);
    margin: 0;
  }
  p.error {
    color: var(--danger);
  }
  input {
    font-family: var(--font-sans);
    font-size: 14px;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--text-hi);
    width: 100%;
    box-sizing: border-box;
  }
  .choice-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .choice-btn {
    font-family: var(--font-sans);
    font-size: 14px;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--text-hi);
    cursor: pointer;
    text-align: left;
  }
  .choice-btn:hover {
    border-color: var(--accent-dim);
  }
  .cancel-link {
    align-self: center;
    background: transparent;
    border: none;
    color: var(--text-faint);
    font-size: 13px;
    cursor: pointer;
    padding: var(--space-1);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  button.cancel,
  button.confirm {
    font-family: var(--font-sans);
    font-size: 13px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid var(--hairline);
    background: transparent;
    color: var(--text-hi);
  }
  button.confirm {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
</style>
