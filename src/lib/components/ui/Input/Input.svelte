<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "",
    class: className = "",
    oninput,
    onkeydown,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    placeholder?: string;
    class?: string;
    oninput?: (e: Event) => void;
    onkeydown?: (e: KeyboardEvent) => void;
    "aria-label"?: string;
  } = $props();
</script>

<input
  type="text"
  bind:value
  {placeholder}
  aria-label={ariaLabel}
  class="input {className}"
  oninput={(e) => oninput?.(e)}
  onkeydown={(e) => onkeydown?.(e)}
/>

<style>
  .input {
    width: 100%;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .input::placeholder {
    color: var(--text-faint);
  }
  .input:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
</style>
