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
    categories,
    onMoveStep,
    onMoveStepTo,
    onToggleStep,
    doneCount = 0,
  }: {
    steps: Step[];
    category: string;
    onAddStep: () => void;
    onUpdateStep: (id: string, title: string, content: string) => void;
    onDeleteStep: (id: string) => void;
    // Round 35: every category of the todo (for "Move to…"), and the two edits.
    categories: string[];
    onMoveStep: (id: string, dir: -1 | 1) => void;
    onMoveStepTo: (id: string, category: string) => void;
    // Round 36: tick/untick, and how many of `steps` are ticked (for the header).
    onToggleStep: (id: string, done: boolean) => void;
    doneCount?: number;
  } = $props();

  const label = $derived(category.charAt(0).toUpperCase() + category.slice(1));
</script>

<div class="steps-section">
  <div class="header">
    <h3>
      {label}
      {#if steps.length > 0}
        <span class="count" class:complete={doneCount === steps.length} aria-label={`${doneCount} of ${steps.length} steps done`}>
          {doneCount}/{steps.length}
        </span>
      {/if}
    </h3>
    <Button size="sm" aria-label="Add step" onclick={onAddStep}>
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
          done={step.done}
          onToggleDone={(d) => onToggleStep(step.id, d)}
          onUpdate={(title, content) => onUpdateStep(step.id, title, content)}
          onDelete={() => onDeleteStep(step.id)}
          canMoveUp={i > 0}
          canMoveDown={i < steps.length - 1}
          otherCategories={categories.filter((c) => c !== category)}
          onMoveUp={() => onMoveStep(step.id, -1)}
          onMoveDown={() => onMoveStep(step.id, 1)}
          onMoveTo={(c) => onMoveStepTo(step.id, c)}
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
  .count {
    margin-left: var(--space-2);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-lo);
  }
  .count.complete {
    color: var(--accent);
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
