<script lang="ts">
  import { toasts, dismissToast } from "$lib/stores/toast.svelte";
</script>

<div class="toast-stack">
  {#each toasts as t (t.id)}
    <div class="toast" class:destructive={t.variant === "destructive"} onclick={() => dismissToast(t.id)} onkeydown={(e) => e.key === "Enter" && dismissToast(t.id)} role="button" tabindex="0">
      <strong>{t.title}</strong>
      {#if t.description}
        <p>{t.description}</p>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    bottom: var(--space-5);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: 80;
    width: min(340px, 90vw);
  }
  .toast {
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: var(--space-3) var(--space-4);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    cursor: pointer;
  }
  .toast.destructive {
    border-left-color: var(--danger);
  }
  .toast strong {
    display: block;
    font-size: 13px;
    color: var(--text-hi);
  }
  .toast p {
    margin: var(--space-1) 0 0;
    font-size: 12px;
    color: var(--text-lo);
  }
</style>
