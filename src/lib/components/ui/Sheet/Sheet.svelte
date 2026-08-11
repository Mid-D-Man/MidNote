<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    side = "left",
    title = "",
    children,
  }: {
    open?: boolean;
    side?: "left" | "right";
    title?: string;
    children: Snippet;
  } = $props();
</script>

{#if open}
  <div class="scrim" onclick={() => (open = false)} role="presentation"></div>
  <div class="sheet {side}">
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
    top: 0;
    bottom: 0;
    width: 280px;
    max-width: 84vw;
    background: var(--surface);
    border-color: var(--hairline);
    z-index: 50;
    display: flex;
    flex-direction: column;
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.4);
  }
  .sheet.left {
    left: 0;
    border-right: 1px solid var(--hairline);
  }
  .sheet.right {
    right: 0;
    border-left: 1px solid var(--hairline);
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
