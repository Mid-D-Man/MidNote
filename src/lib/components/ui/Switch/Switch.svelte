<script lang="ts">
  let {
    checked = $bindable(false),
    onCheckedChange,
    disabled = false,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    "aria-label"?: string;
  } = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onCheckedChange?.(checked);
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  class="switch"
  class:checked
  {disabled}
  onclick={toggle}
>
  <span class="thumb"></span>
</button>

<style>
  .switch {
    flex-shrink: 0;
    width: 44px;
    height: 26px;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface-raised);
    padding: 2px;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .switch.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 0.15s ease;
  }
  .switch.checked .thumb {
    transform: translateX(18px);
  }
</style>
