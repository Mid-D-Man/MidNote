<script lang="ts">
  import { onMount } from "svelte";

  let { oncomplete }: { oncomplete: () => void } = $props();
  let progress = $state(0);

  onMount(() => {
    const interval = setInterval(() => {
      progress = Math.min(progress + 10, 100);
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(oncomplete, 300);
      }
    }, 100);
    return () => clearInterval(interval);
  });
</script>

<div class="loading-screen">
  <div class="content">
    <svg class="mark" viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="var(--accent)" stroke-width="1.5">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
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
  .mark {
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
