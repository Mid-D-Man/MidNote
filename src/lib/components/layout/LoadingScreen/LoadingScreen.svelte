<script lang="ts">
  import { onMount } from "svelte";

  let { oncomplete }: { oncomplete: () => void } = $props();
  let progress = $state(0);

  onMount(() => {
    // BUGFIX (round 22): this used to run for ~1.3s total (10 ticks x
    // 100ms + a 300ms pause) — fine back when only the landing page ever
    // showed this, on top of already-loaded localStorage data, as pure
    // decoration. Since round 22 this screen gates EVERY route's real
    // content on real data actually being ready (see +layout.svelte),
    // so its own fixed minimum needed to shrink well below that: this
    // project's smoke test settles after 1200ms by default
    // (SMOKE_SETTLE_MS in smoke-test-worker.mjs), and the old ~1.3s
    // timer was already cutting that margin razor-thin even before it
    // gated anything real — moving the gate surfaced it as a genuine
    // failure (board — existing) rather than introducing a new one.
    // 450ms total leaves comfortable room under that window while still
    // reading as an intentional animation, not an instant flash.
    const interval = setInterval(() => {
      progress = Math.min(progress + 20, 100);
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(oncomplete, 150);
      }
    }, 60);
    return () => clearInterval(interval);
  });
</script>

<div class="loading-screen">
  <div class="content">
    <img src="/midnote-logo.svg" alt="" class="mark" />
    <div class="labels">
      <h1>MidNote</h1>
      <p>Loading your notes...</p>
    </div>
    <div class="bar">
      <div class="fill" style="width: {progress}%"></div>
    </div>
  </div>
</div>

<style>
  .loading-screen {
    position: fixed;
    inset: 0;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
  }
  /* BUGFIX: this was a generic placeholder book-icon SVG, never the
     actual MidNote logo — swapped for the real mark (same asset
     AppHeader.svelte uses). Same white backing chip as AppHeader's
     .logo-mark and for the identical reason: the logo's colors (black
     base, green/blue-violet accents) are baked into its own paths, not
     currentColor, so a black-heavy logo directly on this screen's dark
     --bg would nearly vanish without it. */
  .mark {
    width: 64px;
    height: 64px;
    padding: 6px;
    border-radius: var(--radius-md);
    background: #ffffff;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .labels {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }
  h1 {
    font-family: var(--font-display);
    font-size: 22px;
    color: var(--text-hi);
    margin: 0;
  }
  p {
    font-size: 13px;
    color: var(--text-lo);
    margin: 0;
  }
  .bar {
    width: 180px;
    height: 3px;
    background: var(--hairline);
    border-radius: 999px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease-out;
  }
</style>
