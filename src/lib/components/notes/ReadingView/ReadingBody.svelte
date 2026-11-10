<script lang="ts">
  // Draws the blocks a screenful at a time: a long story would otherwise put thousands of elements on a phone at once.
  // More blocks are added when the end comes near (and a "Show more" button covers a WebView with no IntersectionObserver).
  // The parent re-creates this component ({#key}) when the note, page or Markdown switch changes, so `shown` starts over.
  import type { Block } from "$lib/utils/markdown";
  import ReadingBlocks from "./ReadingBlocks.svelte";

  let { blocks }: { blocks: Block[] } = $props();

  const STEP = 120;
  let shown = $state(STEP);
  const visible = $derived(blocks.slice(0, shown));
  const more = $derived(blocks.length - visible.length);

  function grow() {
    shown = shown + STEP;
  }

  // An action, not an effect: it runs once when the end marker appears and reports back through a callback.
  function watchEnd(node: HTMLElement) {
    if (typeof IntersectionObserver === "undefined") return {};
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        grow();
        // still near the end after growing? look again (an observer only reports changes)
        io.unobserve(node);
        requestAnimationFrame(() => io.observe(node));
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
</script>

<ReadingBlocks blocks={visible} />
{#if more > 0}
  <div class="end" use:watchEnd>
    <button type="button" class="more" aria-label="Show more" onclick={grow}>Show more</button>
  </div>
{/if}

<style>
  .end {
    display: flex;
    justify-content: center;
    padding: var(--space-4) 0;
  }
  .more {
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    color: var(--text-lo);
    border-radius: 999px;
    padding: 8px 18px;
    font-size: 13px;
    cursor: pointer;
  }
</style>
