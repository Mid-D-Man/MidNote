<script lang="ts">
  // App-center busy overlay — see globalBusy.svelte.ts's header comment
  // for what drives it and why. Mounted once in +layout.svelte
  // (alongside Toast/LockPrompt/DebugPanel), not per-page, so it's
  // correct regardless of which screen a lock/unlock/re-lock happens
  // from.
  import { globalBusy } from "$lib/stores/globalBusy.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
</script>

{#if globalBusy.active}
  <div class="overlay" role="status" aria-live="polite">
    <div class="panel">
      <Spinner class="overlay-spinner" />
      <span>{globalBusy.label}</span>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 6, 16, 0.45);
  }
  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--surface-raised);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    color: var(--text-hi);
    font-size: 14px;
    font-weight: 500;
    min-width: 160px;
  }
  /* Same override reasoning as note/[id]/+page.svelte's .unlock-spinner
     — Spinner.svelte's default two-tone (--hairline/--accent) reads
     poorly on this dark scrim; plain opacity, not color-mix(), for the
     same Android WebView compatibility reason as everywhere else this
     app avoids it. */
  :global(.overlay-spinner) {
    width: 32px !important;
    height: 32px !important;
  }
  :global(.overlay-spinner circle) {
    stroke: var(--text-hi);
    opacity: 0.3;
  }
  :global(.overlay-spinner path) {
    stroke: var(--accent);
  }
</style>
