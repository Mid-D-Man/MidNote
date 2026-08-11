<script lang="ts">
  // Real Supabase auth deferred (see AppHeader's sync button). This is a
  // working dialog shell — open/close, real markup — with an honest
  // "not implemented" submit rather than a fake login.
  import { pushToast } from "$lib/stores/toast.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  function submit(e: Event) {
    e.preventDefault();
    pushToast({ title: "Auth not wired up yet", description: "Supabase login isn't connected in MidNote yet." });
    open = false;
  }
</script>

{#if open}
  <div class="scrim" onclick={() => (open = false)} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true">
    <h2>Sign in</h2>
    <form onsubmit={submit}>
      <input type="email" placeholder="Email" required />
      <input type="password" placeholder="Password" required />
      <button type="submit">Continue</button>
    </form>
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
    width: min(320px, 88vw);
    z-index: 70;
  }
  h2 {
    font-family: var(--font-display);
    font-size: 17px;
    margin: 0 0 var(--space-4);
    color: var(--text-hi);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  input {
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  button {
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    font-weight: 500;
    cursor: pointer;
  }
</style>
