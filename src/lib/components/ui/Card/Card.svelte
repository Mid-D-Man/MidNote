<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    onclick,
    class: className = "",
    children,
  }: {
    onclick?: (e: MouseEvent) => void;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="card {className}"
  class:clickable={!!onclick}
  onclick={(e) => onclick?.(e)}
  onkeydown={(e) => e.key === "Enter" && onclick?.(e as unknown as MouseEvent)}
  role={onclick ? "button" : undefined}
  tabindex={onclick ? 0 : undefined}
>
  {@render children()}
</div>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    position: relative;
  }
  .clickable {
    cursor: pointer;
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .clickable:hover {
    border-color: var(--accent-dim);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  }
</style>
