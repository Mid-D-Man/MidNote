<script lang="ts">
  // Round 37 — a small bar that is on screen exactly while something is being
  // read aloud, so stopping never means digging back into the Actions menu.
  // Reading stops when the editor that started it closes, so this only ever
  // shows on an editor page.
  import { readAloud, readBarLift, stopReadingFor } from "$lib/stores/readAloud.svelte";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";

  const active = $derived(readAloud.status !== "idle" && readAloud.id !== null);
</script>

{#if active}
  <!-- Same bottom slot as the editor's panels (FormattingToolbar): the keyboard
       inset moves it with the keyboard, and readBarLift raises it above whatever
       panel the page has there. -->
  <div
    class="bar"
    data-lift={readBarLift.px}
    role="status"
    aria-live="polite"
    style="bottom: calc(max(var(--space-4), env(safe-area-inset-bottom)) + {getKeyboardInset()}px + {readBarLift.px}px)"
  >
    <span class="dot" aria-hidden="true"></span>
    <span class="label">{readAloud.status === "starting" ? "Starting…" : "Reading…"}</span>
    <button type="button" class="stop" aria-label="Stop reading" onclick={() => readAloud.id && stopReadingFor(readAloud.id)}>Stop</button>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    /* one line, sized to its content — it used to wrap ("Reading / aloud…", "St / op") */
    width: max-content;
    max-width: calc(100vw - var(--space-6));
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
    background: var(--surface-raised, var(--surface));
    border: 1px solid var(--accent);
    border-radius: 999px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    color: var(--text-hi);
    font-size: 14px;
    /* above page content and sheets' scrim-free areas, below toasts (500) */
    z-index: 400;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .stop {
    flex-shrink: 0;
    white-space: nowrap;
    min-height: 34px;
    padding: 0 var(--space-4);
    background: var(--accent);
    border: none;
    border-radius: 999px;
    color: var(--bg);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
</style>
