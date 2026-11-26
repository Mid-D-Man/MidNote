<script lang="ts">
  // "The AI is thinking": a small animated drawing for Create with AI. A four-point spark that slowly turns and breathes in the
  // middle, three small stars orbiting it at different speeds, and a few words that change while it works. All SVG and CSS
  // animation (no timers but the one that changes the words), in the app's accent colour. With "reduce motion" everything holds
  // still and only the words change. State is written from onMount and its timer only.
  import { onMount } from "svelte";

  let { words = ["Thinking", "Putting it together", "Almost there"], size = 96 }: { words?: string[]; size?: number } = $props();

  let at = $state(0);
  onMount(() => {
    if (words.length < 2) return;
    const timer = setInterval(() => (at = (at + 1) % words.length), 2600);
    return () => clearInterval(timer);
  });
</script>

<div class="thinking" role="status" aria-live="polite" aria-label="Thinking">
  <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
    <defs>
      <radialGradient id="think-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
      </radialGradient>
    </defs>
    <circle class="glow" cx="50" cy="50" r="38" fill="url(#think-glow)" />
    <circle class="ring" cx="50" cy="50" r="30" fill="none" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="2 5" />
    <!-- the three small stars: each on its own orbit and speed -->
    <g class="orbit o1"><path class="star" d="M50 14 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" /></g>
    <g class="orbit o2"><path class="star" d="M50 22 l1.2 2.5 2.5 1.2 -2.5 1.2 -1.2 2.5 -1.2 -2.5 -2.5 -1.2 2.5 -1.2z" /></g>
    <g class="orbit o3"><circle class="dot" cx="50" cy="12" r="2" /></g>
    <!-- the spark in the middle -->
    <g class="spark">
      <path d="M50 30 C52 44 56 48 70 50 C56 52 52 56 50 70 C48 56 44 52 30 50 C44 48 48 44 50 30Z" />
    </g>
  </svg>
  <p class="words" aria-hidden="true">
    {#key at}<span>{words[at] ?? ""}{#if true}<span class="dots"><i>.</i><i>.</i><i>.</i></span>{/if}</span>{/key}
  </p>
</div>

<style>
  .thinking {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    color: var(--accent);
  }
  svg {
    display: block;
    overflow: visible;
  }
  .spark {
    fill: var(--accent);
    transform-origin: 50px 50px;
    animation:
      turn 9s linear infinite,
      breathe 2.8s ease-in-out infinite;
  }
  .glow {
    transform-origin: 50px 50px;
    animation: glow 2.8s ease-in-out infinite;
  }
  .ring {
    transform-origin: 50px 50px;
    animation: turn 24s linear infinite reverse;
  }
  .orbit {
    transform-origin: 50px 50px;
  }
  .star,
  .dot {
    fill: var(--accent);
    opacity: 0.8;
  }
  .o1 {
    animation: turn 5.5s linear infinite;
  }
  .o2 {
    animation: turn 8.5s linear infinite reverse;
  }
  .o3 {
    animation: turn 3.6s linear infinite;
  }
  .words {
    margin: 0;
    min-height: 1.4em;
    font-size: 14px;
    color: var(--text-lo);
    text-align: center;
  }
  .words span {
    animation: word-in 0.5s ease-out;
    display: inline-block;
  }
  .dots i {
    font-style: normal;
    animation: blink 1.4s infinite both;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes breathe {
    0%,
    100% {
      scale: 0.86;
    }
    50% {
      scale: 1.08;
    }
  }
  @keyframes glow {
    0%,
    100% {
      opacity: 0.55;
      scale: 0.9;
    }
    50% {
      opacity: 1;
      scale: 1.1;
    }
  }
  @keyframes word-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.2;
    }
    40% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spark,
    .glow,
    .ring,
    .o1,
    .o2,
    .o3,
    .words span,
    .dots i {
      animation: none !important;
    }
  }
</style>
