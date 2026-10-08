<script lang="ts">
  // Round 42 — one row of a settings list: label + description on the left, then
  // whatever goes on the right (a switch, a swatch, a value, a chevron). With
  // `onclick` the whole row is a button; without it, it is plain content.
  import type { Snippet } from "svelte";

  let {
    label,
    desc = "",
    value = "",
    chevron = false,
    onclick,
    "aria-label": ariaLabel,
    children,
  }: {
    label: string;
    desc?: string;
    value?: string;
    /** Show a ">" — this row opens another page. */
    chevron?: boolean;
    onclick?: () => void;
    "aria-label"?: string;
    /** Trailing control (Switch, swatch, text button). */
    children?: Snippet;
  } = $props();
</script>

{#snippet inner()}
  <div class="text">
    <span class="label">{label}</span>
    {#if desc}<span class="desc">{desc}</span>{/if}
  </div>
  {#if children}{@render children()}{/if}
  {#if value}<span class="value">{value}</span>{/if}
  {#if chevron}
    <svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  {/if}
{/snippet}

{#if onclick}
  <button type="button" class="row clickable" aria-label={ariaLabel} {onclick}>{@render inner()}</button>
{:else}
  <div class="row">{@render inner()}</div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    min-height: 44px;
    padding: var(--space-3) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    text-align: left;
    color: var(--text-hi);
  }
  .clickable {
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .clickable:hover {
    background: var(--surface-raised, var(--surface));
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-hi);
  }
  .desc {
    font-size: 12px;
    color: var(--text-faint);
  }
  .value {
    flex-shrink: 0;
    font-size: 13px;
    color: var(--text-lo);
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    flex-shrink: 0;
    color: var(--text-faint);
  }
</style>
