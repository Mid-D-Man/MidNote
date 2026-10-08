<script lang="ts">
  // Round 37/40/41/42 — the bar that is on screen while something is being read aloud, so
  // stopping, pausing and replaying never mean digging back into the Actions menu.
  //   [ ──────────●────────── ]  seek slider (one step per sentence-sized piece)
  //   starting  "Starting…"  [Pause]  [Replay] [Stop]
  //   reading   "Reading…"   [Pause]  [Replay] [Stop]
  //   paused    "Paused"     [Resume] [Replay] [Stop]
  //   done      "Finished"            [Replay] [Close]
  // Round 41: the bar does not change size or position between those states.
  // It used to shrink to "Starting… [Stop]" and grow back on every Resume/Replay,
  // re-centering each time (a transform-based centre), and tapping it moved focus
  // off the editor — which closed the keyboard and made the whole screen jump.
  // Round 42: a fixed width, a seek slider on top, and "Reading… 3/12" so the
  // position (where Resume will pick up) is always visible.
  // Reading stops when the editor that started it closes, so this only ever shows
  // on an editor page. It sits in the same bottom slot as the editor's panels: the
  // keyboard inset moves it with the keyboard, readBarLift raises it above the panel.
  import { readAloud, readBarLift, stopReadingFor, pauseReading, resumeReading, replayReading, seekReading, closeReading } from "$lib/stores/readAloud.svelte";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";

  const status = $derived(readAloud.status);
  const active = $derived(status !== "idle" && readAloud.id !== null);
  const total = $derived(readAloud.chunkCount);
  // While the thumb is being dragged it shows the finger's position, not the engine's.
  let dragValue = $state<number | null>(null);
  const shown = $derived(dragValue ?? readAloud.index);
  const label = $derived.by(() => {
    if (status === "done") return "Finished";
    const base = status === "starting" ? "Starting…" : status === "paused" ? "Paused" : "Reading…";
    return total > 1 ? `${base} ${shown + 1}/${total}` : base;
  });

  function onSeekInput(e: Event) {
    dragValue = Number((e.currentTarget as HTMLInputElement).value);
  }
  function onSeekCommit(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    dragValue = null;
    void seekReading(v);
  }

  // Pressing a button normally moves focus to it; with the editor focused that
  // hides the keyboard and re-lays-out the page. Stop the focus move — the click
  // still goes through.
  function keepEditorFocus(e: Event) {
    // The slider needs the press itself (preventDefault would stop the thumb from dragging).
    if ((e.target as Element | null)?.closest("input")) return;
    e.preventDefault();
  }
</script>

{#if active}
  <!-- The listeners only stop a focus move (see keepEditorFocus); every control inside is a real <button>. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="bar"
    data-lift={readBarLift.px}
    data-status={status}
    role="status"
    aria-live="off"
    style="bottom: calc(max(var(--space-4), env(safe-area-inset-bottom)) + {getKeyboardInset()}px + {readBarLift.px}px)"
    onmousedown={keepEditorFocus}
    onpointerdown={keepEditorFocus}
  >
    {#if total > 1}
      <input
        class="seek"
        type="range"
        min="0"
        max={total - 1}
        step="1"
        value={shown}
        aria-label="Seek reading"
        aria-valuetext={`Part ${shown + 1} of ${total}`}
        oninput={onSeekInput}
        onchange={onSeekCommit}
      />
    {/if}
    <div class="controls">
    <span class="dot" class:still={status === "paused" || status === "done"} aria-hidden="true"></span>
    <span class="label">{label}</span>

    {#if status === "paused"}
      <button type="button" class="icon" aria-label="Resume reading" onclick={() => void resumeReading()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4" /></svg>
      </button>
    {:else if status !== "done"}
      <button type="button" class="icon" aria-label="Pause reading" onclick={() => void pauseReading()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      </button>
    {/if}

    <button type="button" class="icon" aria-label="Replay reading" onclick={() => void replayReading()}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polyline points="1 4 1 10 7 10" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
      </svg>
    </button>

    {#if status === "done"}
      <button type="button" class="stop" aria-label="Close reading bar" onclick={() => void closeReading()}>Close</button>
    {:else}
      <button type="button" class="stop" aria-label="Stop reading" onclick={() => readAloud.id && stopReadingFor(readAloud.id)}>Stop</button>
    {/if}
    </div>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    /* centred with auto margins, NOT a transform: nothing to re-compute when the content changes */
    left: 0;
    right: 0;
    margin: 0 auto;
    /* a FIXED width: nothing resizes when the state or the label changes */
    width: min(calc(100vw - var(--space-6)), 380px);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-1) var(--space-1) var(--space-4);
    background: var(--surface-raised, var(--surface));
    border: 1px solid var(--accent);
    border-radius: 24px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    color: var(--text-hi);
    font-size: 14px;
    /* above page content and sheets' scrim-free areas, below toasts (500) */
    z-index: 400;
    /* no grey tap flash / text selection when pressing the buttons */
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
    animation: rise 140ms ease-out;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .seek {
    display: block;
    width: calc(100% - var(--space-3));
    height: 28px;
    margin: 0;
    accent-color: var(--accent);
    touch-action: pan-y;
  }
  .label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    margin-right: var(--space-1);
    font-variant-numeric: tabular-nums;
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
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .icon:hover {
    background: var(--surface);
  }
  .stop {
    flex-shrink: 0;
    white-space: nowrap;
    /* "Stop" and "Close" take the same room */
    min-width: 64px;
    min-height: 34px;
    padding: 0 var(--space-4);
    background: var(--accent);
    border: none;
    border-radius: 999px;
    color: var(--bg);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  /* the bar appears with a short fade/lift; it only runs when the bar is added, not on state changes */
  @keyframes rise {
    from { opacity: 0; translate: 0 8px; }
    to { opacity: 1; translate: 0 0; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
    .bar { animation: none; }
  }
</style>
