<script lang="ts">
  import Button from "$lib/components/ui/Button/Button.svelte";
  import TodoStepCard from "./TodoStepCard.svelte";
  import type { Step } from "$lib/types/entry";

  let {
    steps,
    category,
    onAddStep,
    onUpdateStep,
    onDeleteStep,
  }: {
    steps: Step[];
    category: string;
    onAddStep: () => void;
    onUpdateStep: (id: string, title: string, content: string) => void;
    onDeleteStep: (id: string) => void;
  } = $props();

  const label = $derived(category.charAt(0).toUpperCase() + category.slice(1));
</script>

<div class="steps-section">
  <div class="header">
    <h3>{label}</h3>
    <Button size="sm" onclick={onAddStep}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Add Step
    </Button>
  </div>

  <div class="list">
    {#if steps.length === 0}
      <div class="empty">
        <p>No steps yet.</p>
        <p>Click "Add Step" to get started!</p>
      </div>
    {:else}
      {#each steps as step, i (step.id)}
        <TodoStepCard
          stepNumber={i + 1}
          title={step.title}
          content={step.content}
          onUpdate={(title, content) => onUpdateStep(step.id, title, content)}
          onDelete={() => onDeleteStep(step.id)}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .steps-section {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .header {
    flex-shrink: 0;
    padding: var(--space-4);
    border-bottom: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .header h3 {
    font-family: var(--font-display);
    font-size: 15px;
    color: var(--text-hi);
    margin: 0;
    min-width: 0;
    overflow-wrap: break-word;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-4);
    padding-bottom: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
</style>
