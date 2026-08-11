<script lang="ts">
  // Placeholder — the todo editor (category tabs, steps, annotations) is
  // the next slice, matching TodoHeader/TodoCategoryTabs/TodoStepsSection/
  // TodoAnnotationsSidebar's stub components in src/lib/components/todos/.
  // This exists so the "Todos" tab on the main list is navigable now
  // instead of 404ing, not as a finished page.
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button/Button.svelte";
</script>

<main class="placeholder">
  <p>The todo editor isn't built yet — next up.</p>
  <Button onclick={() => goto("/")}>Back to MidNote</Button>
</main>

<style>
  .placeholder {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    background: var(--bg);
    color: var(--text-lo);
    font-size: 14px;
  }
</style>
