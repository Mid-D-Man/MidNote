<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    variant = "default",
    size = "default",
    disabled = false,
    onclick,
    class: className = "",
    children,
    ...rest
  }: {
    variant?: "default" | "ghost" | "outline";
    size?: "default" | "sm" | "lg" | "icon";
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    class?: string;
    children: Snippet;
    "aria-label"?: string;
    [key: string]: unknown;
  } = $props();
</script>

<button
  class="btn btn-{variant} btn-{size} {className}"
  {disabled}
  onclick={(e) => onclick?.(e)}
  {...rest}
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-default {
    background: var(--accent);
    color: var(--bg);
  }
  .btn-default:hover:not(:disabled) {
    background: var(--accent-dim);
    color: var(--text-hi);
  }

  .btn-ghost {
    background: transparent;
    /* Falls back to the original fixed value when no themed ancestor
       sets --theme-text-hi (true almost everywhere Button is used) —
       see NoteEditorHeader.svelte/TodoHeader.svelte's has-image-theme
       block and +page.svelte's body-has-image block for the two
       places that do set it, over a header/body image theme
       respectively. Baked in here rather than a per-caller :global()
       override so ANY future themed context automatically gets
       legible icon buttons for free, not just these two. */
    color: var(--theme-text-hi, var(--text-hi));
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--surface-raised);
  }

  .btn-outline {
    background: var(--theme-tag-bg, transparent);
    border-color: var(--theme-text-lo, var(--hairline));
    color: var(--theme-text-hi, var(--text-hi));
  }
  .btn-outline:hover:not(:disabled) {
    background: var(--surface-raised);
  }

  .btn-default,
  .btn-outline,
  .btn-ghost {
    padding: var(--space-2) var(--space-4);
    font-size: 14px;
  }
  .btn-sm {
    padding: var(--space-1) var(--space-3);
    font-size: 13px;
    height: 28px;
  }
  .btn-lg {
    padding: var(--space-3) var(--space-5);
    font-size: 15px;
  }
  .btn-icon {
    padding: var(--space-2);
    width: 36px;
    height: 36px;
  }
</style>
