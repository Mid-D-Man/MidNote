<script lang="ts">
  import { toasts } from "$lib/stores/toast.svelte";
  import ToastItem from "./ToastItem.svelte";
</script>

<div class="toast-stack">
  {#each toasts as t (t.id)}
    <ToastItem toast={t} />
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    top: max(var(--space-4), env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    /* Above absolutely everything — dialogs (70), the debug panel (170),
       all of it. A save confirmation that's hidden behind a dialog isn't
       useful. */
    z-index: 500;
    width: min(340px, 90vw);
  }
</style>
