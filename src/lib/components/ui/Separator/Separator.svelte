<script lang="ts">
  let { orientation = "horizontal" }: { orientation?: "horizontal" | "vertical" } = $props();
</script>

<div class="separator {orientation}"></div>

<style>
  .separator {
    background: var(--hairline);
    flex-shrink: 0;
  }
  .horizontal {
    height: 1px;
    width: 100%;
  }
  .vertical {
    width: 1px;
    align-self: stretch;
  }
</style>
