<script lang="ts">
  // The original was a permanent collapsible side rail (280-360px wide,
  // sitting beside the steps section) — a desktop pattern that would
  // force horizontal overflow on a phone screen, exactly the class of
  // bug already fixed once this session. Mobile-first here means this
  // is a Sheet (full slide-in panel) triggered by a button instead of a
  // panel that's always partially on-screen. Revisit as a real side
  // panel behind a min-width media query once desktop is the target.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import TodoAnnotationCard from "./TodoAnnotationCard.svelte";
  import type { Annotation } from "$lib/types/entry";

  let {
    open = $bindable(false),
    annotations,
    currentCategory,
    onAddAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
  }: {
    open?: boolean;
    annotations: Annotation[];
    currentCategory: string;
    onAddAnnotation: (category: string) => void;
    onUpdateAnnotation: (id: string, title: string, content: string) => void;
    onDeleteAnnotation: (id: string) => void;
  } = $props();

  const categoryAnnotations = $derived(annotations.filter((a) => a.category === currentCategory));
</script>

<Sheet bind:open side="right" title="Notes">
  <div class="sidebar">
    <div class="header">
      <p class="category-label">{currentCategory}</p>
      <Button size="sm" variant="outline" onclick={() => onAddAnnotation(currentCategory)}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add
      </Button>
    </div>

    {#if categoryAnnotations.length === 0}
      <div class="empty">
        <p>No notes yet.</p>
        <p>Add one to get started!</p>
      </div>
    {:else}
      <div class="list">
        {#each categoryAnnotations as a (a.id)}
          <TodoAnnotationCard
            title={a.title}
            content={a.content}
            onUpdate={(title, content) => onUpdateAnnotation(a.id, title, content)}
            onDelete={() => onDeleteAnnotation(a.id)}
          />
        {/each}
      </div>
    {/if}
  </div>
</Sheet>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .category-label {
    font-size: 13px;
    color: var(--text-lo);
    margin: 0;
    text-transform: capitalize;
    min-width: 0;
    overflow-wrap: break-word;
  }
  .empty {
    text-align: center;
    padding: var(--space-6) 0;
  }
  .empty p {
    font-size: 13px;
    color: var(--text-lo);
    margin: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
