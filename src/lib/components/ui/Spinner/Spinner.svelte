<script lang="ts">
  let { class: className = "" }: { class?: string } = $props();
</script>

<svg class="spinner {className}" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="var(--hairline)" stroke-width="2.5" />
  <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" />
</svg>

<style>
  .spinner {
    width: 20px;
    height: 20px;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
