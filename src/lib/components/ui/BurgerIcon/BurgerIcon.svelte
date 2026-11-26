<script lang="ts">
  // The menu icon: three lines that turn into a cross when `open` is true, and back. The lines animate with CSS transitions only,
  // so it follows the colour of whatever it sits in (currentColor). `playIn` starts it as three lines and turns it into the cross
  // right after it appears, for a copy of the icon that is shown only once the menu is already opening.
  import { onMount } from "svelte";

  let { open = false, playIn = false, size = 20 }: { open?: boolean; playIn?: boolean; size?: number } = $props();

  let started = $state(false);
  onMount(() => {
    if (!playIn) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => (started = true)));
    return () => cancelAnimationFrame(id);
  });
  const crossed = $derived(playIn ? started : open);
</script>

<svg class="burger" class:crossed viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <line class="l top" x1="3" y1="6" x2="21" y2="6" />
  <line class="l mid" x1="3" y1="12" x2="21" y2="12" />
  <line class="l bot" x1="3" y1="18" x2="21" y2="18" />
</svg>

<style>
  .burger {
    display: block;
  }
  .l {
    transform-box: fill-box;
    transform-origin: center;
    transition:
      transform 0.28s cubic-bezier(0.3, 0.8, 0.2, 1),
      opacity 0.18s ease;
  }
  .crossed .top {
    transform: translateY(6px) rotate(45deg);
  }
  .crossed .mid {
    opacity: 0;
    transform: scaleX(0.2);
  }
  .crossed .bot {
    transform: translateY(-6px) rotate(-45deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .l {
      transition: none;
    }
  }
</style>
