<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    align = "end",
    trigger,
    children,
  }: {
    align?: "start" | "end";
    trigger: Snippet<[() => void]>;
    children: Snippet;
  } = $props();

  let open = $state(false);
  function toggle() {
    open = !open;
  }
  function close() {
    open = false;
  }
</script>

<div class="dropdown">
  {@render trigger(toggle)}
  {#if open}
    <div class="scrim" onclick={close} onkeydown={(e) => e.key === "Escape" && close()} role="presentation"></div>
    <div class="menu {align}" onclick={close} onkeydown={(e) => e.key === "Escape" && close()} role="menu" tabindex="-1">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-block;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    min-width: 180px;
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    z-index: 50;
    padding: var(--space-1);
  }
  .menu.end {
    right: 0;
  }
  .menu.start {
    left: 0;
  }
</style>
