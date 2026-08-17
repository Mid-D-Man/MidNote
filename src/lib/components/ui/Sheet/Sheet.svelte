<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    side = "left",
    title = "",
    children,
  }: {
    open?: boolean;
    side?: "left" | "right" | "bottom";
    title?: string;
    children: Snippet;
  } = $props();
</script>

{#if open}
  <div class="scrim" onclick={() => (open = false)} role="presentation"></div>
  <div class="sheet {side}">
    {#if side === "bottom"}
      <div class="drag-handle"></div>
    {/if}
    {#if title}
      <div class="sheet-header">
        <h2>{title}</h2>
      </div>
    {/if}
    <div class="sheet-body">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 16, 0.6);
    z-index: 40;
  }
  .sheet {
    position: fixed;
    background: var(--surface);
    border-color: var(--hairline);
    z-index: 50;
    display: flex;
    flex-direction: column;
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.4);
  }
  .sheet.left,
  .sheet.right {
    top: 0;
    bottom: 0;
    width: 280px;
    max-width: 84vw;
  }
  .sheet.left {
    left: 0;
    border-right: 1px solid var(--hairline);
  }
  .sheet.right {
    right: 0;
    border-left: 1px solid var(--hairline);
  }

  /* Bottom — modeled on the Notion reference: rises from the bottom
     edge, rounded top corners, a drag handle, max height rather than a
     fixed one so short action lists don't leave a huge empty sheet. */
  .sheet.bottom {
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 80dvh;
    border-top-left-radius: var(--radius-md);
    border-top-right-radius: var(--radius-md);
    border-top: 1px solid var(--hairline);
    padding-bottom: env(safe-area-inset-bottom);
    animation: rise 0.18s ease-out;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .drag-handle {
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: var(--hairline);
    margin: var(--space-3) auto 0;
    flex-shrink: 0;
  }

  .sheet-header {
    padding: var(--space-4);
    border-bottom: 1px solid var(--hairline);
  }
  .sheet-header h2 {
    font-family: var(--font-display);
    font-size: 16px;
  }
  .sheet-body {
    padding: var(--space-4);
    overflow-y: auto;
    flex: 1;
  }
</style>
