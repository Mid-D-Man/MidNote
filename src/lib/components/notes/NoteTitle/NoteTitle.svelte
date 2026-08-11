<script lang="ts">
  let { value = $bindable("") }: { value?: string } = $props();
</script>

<input type="text" bind:value placeholder="Note title..." class="note-title" />

<style>
  .note-title {
    width: 100%;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    color: var(--text-hi);
    background: transparent;
    border: none;
    padding: 0 0 var(--space-4);
    margin-bottom: var(--space-2);
    border-bottom: 1px solid var(--accent-2-wash);
  }
  .note-title::placeholder {
    color: var(--text-faint);
  }
  .note-title:focus {
    outline: none;
  }
</style>
