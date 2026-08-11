<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    align = "start",
    trigger,
    children,
  }: {
    open?: boolean;
    align?: "start" | "end";
    trigger: Snippet<[() => void]>;
    children: Snippet;
  } = $props();

  function toggle() {
    open = !open;
  }
  function close() {
    open = false;
  }
</script>

<div class="popover-wrap">
  {@render trigger(toggle)}
  {#if open}
    <div class="scrim" onclick={close} role="presentation"></div>
    <div class="popover {align}">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .popover-wrap {
    position: relative;
    display: inline-block;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .popover {
    position: absolute;
    top: calc(100% + 6px);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    padding: var(--space-3);
    z-index: 50;
    min-width: 220px;
  }
  .popover.end {
    right: 0;
  }
  .popover.start {
    left: 0;
  }
</style>
