<script lang="ts">
  import Card from "$lib/components/ui/Card/Card.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";
  import Textarea from "$lib/components/ui/Textarea/Textarea.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";

  let {
    stepNumber,
    title,
    content,
    onUpdate,
    onDelete,
    canMoveUp = false,
    canMoveDown = false,
    otherCategories = [],
    onMoveUp,
    onMoveDown,
    onMoveTo,
  }: {
    stepNumber: number;
    title: string;
    content: string;
    onUpdate: (title: string, content: string) => void;
    onDelete: () => void;
    // Round 35: reorder within the category, and re-file under another one.
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    otherCategories?: string[];
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onMoveTo?: (category: string) => void;
  } = $props();

  function commitTitle(v: string) {
    onUpdate(v, content);
  }
  function commitContent(v: string) {
    onUpdate(title, v);
  }
</script>

<Card class="step-card">
  <div class="row">
    <span class="step-num">Step {stepNumber}</span>
    <Input value={title} oninput={(e) => commitTitle((e.target as HTMLInputElement).value)} placeholder="Step title..." aria-label="Step title" class="title-input" />
    <Button variant="ghost" size="icon" aria-label="Delete step" onclick={onDelete} class="delete-btn">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </Button>
  </div>
  <div class="tools">
    <button type="button" class="tool" disabled={!canMoveUp} onclick={() => onMoveUp?.()} aria-label="Move step up">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15" /></svg>
    </button>
    <button type="button" class="tool" disabled={!canMoveDown} onclick={() => onMoveDown?.()} aria-label="Move step down">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
    </button>
    {#if otherCategories.length > 0}
      <select
        class="move-to"
        aria-label="Move step to category"
        value=""
        onchange={(e) => {
          const sel = e.currentTarget as HTMLSelectElement;
          const target = sel.value;
          sel.value = ""; // back to the prompt; the step is leaving this list anyway
          if (target) onMoveTo?.(target);
        }}
      >
        <option value="" disabled>Move to…</option>
        {#each otherCategories as c (c)}
          <option value={c}>{c}</option>
        {/each}
      </select>
    {/if}
  </div>
  <Textarea
    value={content}
    oninput={(e) => commitContent((e.currentTarget as HTMLTextAreaElement).value)}
    placeholder="Describe this step in detail..."
    minHeight="100px"
  />
</Card>

<style>
  :global(.step-card) {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tool {
    width: 36px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    cursor: pointer;
  }
  .tool:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .move-to {
    margin-left: auto;
    max-width: 55%;
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    font-size: 13px;
  }
  .step-num {
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
  }
  :global(.title-input) {
    flex: 1;
    min-width: 0;
  }
  :global(.delete-btn) {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
  }
</style>
