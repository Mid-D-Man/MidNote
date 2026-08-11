<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    onclick,
    class: className = "",
    children,
  }: {
    onclick?: () => void;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<button class="item {className}" onclick={() => onclick?.()}>
  {@render children()}
</button>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    font-size: 13px;
    color: var(--text-hi);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .item:hover {
    background: var(--accent-wash);
  }
</style>
