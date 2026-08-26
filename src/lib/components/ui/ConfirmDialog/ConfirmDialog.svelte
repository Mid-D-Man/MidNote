<script lang="ts">
  let {
    open = $bindable(false),
    title = "Are you sure?",
    description = "",
    confirmLabel = "Confirm",
    danger = false,
    onconfirm,
    oncancel,
  }: {
    open?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    danger?: boolean;
    onconfirm?: () => void;
    // Optional — most callers don't need to react to a dismissal, only
    // to a confirm. Cancelling via the Cancel button and via tapping the
    // scrim both count as the same "cancel" outcome.
    oncancel?: () => void;
  } = $props();

  function confirm() {
    onconfirm?.();
    open = false;
  }

  function cancel() {
    oncancel?.();
    open = false;
  }

  function onScrimClick() {
    cancel();
  }
</script>

{#if open}
  <div class="scrim" onclick={onScrimClick} role="presentation"></div>
  <div class="dialog" role="alertdialog" aria-modal="true">
    <h2>{title}</h2>
    {#if description}
      <p>{description}</p>
    {/if}
    <div class="actions">
      <button class="cancel" onclick={cancel}>Cancel</button>
      <button class="confirm" class:danger onclick={confirm}>{confirmLabel}</button>
    </div>
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
  }
  h2 {
    font-family: var(--font-display);
    font-size: 17px;
    margin: 0 0 var(--space-2);
  }
  p {
    font-size: 13px;
    color: var(--text-lo);
    margin: 0 0 var(--space-4);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  button {
    font-family: var(--font-sans);
    font-size: 13px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid var(--hairline);
    background: transparent;
    color: var(--text-hi);
  }
  .confirm {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .confirm.danger {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--text-hi);
  }
</style>
