<script lang="ts">
  // Round 37/40 — the bar that is on screen while something is being read aloud, so
  // stopping, pausing and replaying never mean digging back into the Actions menu.
  //   starting  "Starting…"            [Stop]
  //   reading   "Reading…"   [Pause] [Replay] [Stop]
  //   paused    "Paused"     [Resume] [Replay] [Stop]
  //   done      "Finished"   [Replay] [Close]
  // Reading stops when the editor that started it closes, so this only ever shows
  // on an editor page. It sits in the same bottom slot as the editor's panels: the
  // keyboard inset moves it with the keyboard, readBarLift raises it above the panel.
  import { readAloud, readBarLift, stopReadingFor, pauseReading, resumeReading, replayReading, closeReading } from "$lib/stores/readAloud.svelte";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";

  const status = $derived(readAloud.status);
  const active = $derived(status !== "idle" && readAloud.id !== null);
  const label = $derived(status === "starting" ? "Starting…" : status === "paused" ? "Paused" : status === "done" ? "Finished" : "Reading…");
</script>

{#if active}
  <div
    class="bar"
    data-lift={readBarLift.px}
    data-status={status}
    role="status"
    aria-live="polite"
    style="bottom: calc(max(var(--space-4), env(safe-area-inset-bottom)) + {getKeyboardInset()}px + {readBarLift.px}px)"
  >
    <span class="dot" class:still={status === "paused" || status === "done"} aria-hidden="true"></span>
    <span class="label">{label}</span>

    {#if status === "reading"}
      <button type="button" class="icon" aria-label="Pause reading" onclick={() => void pauseReading()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      </button>
    {:else if status === "paused"}
      <button type="button" class="icon" aria-label="Resume reading" onclick={() => void resumeReading()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4" /></svg>
      </button>
    {/if}

    {#if status === "reading" || status === "paused" || status === "done"}
      <button type="button" class="icon" aria-label="Replay reading" onclick={() => void replayReading()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="1 4 1 10 7 10" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
        </svg>
      </button>
    {/if}

    {#if status === "done"}
      <button type="button" class="stop" aria-label="Close reading bar" onclick={() => void closeReading()}>Close</button>
    {:else}
      <button type="button" class="stop" aria-label="Stop reading" onclick={() => readAloud.id && stopReadingFor(readAloud.id)}>Stop</button>
    {/if}
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
    gap: var(--space-2);
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
    margin-right: var(--space-1);
  }
  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dot.still {
    animation: none;
    opacity: 0.5;
  }
  .icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--text-hi);
    cursor: pointer;
  }
  .icon:hover {
    background: var(--surface);
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
