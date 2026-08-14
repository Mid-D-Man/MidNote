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
  }: {
    stepNumber: number;
    title: string;
    content: string;
    onUpdate: (title: string, content: string) => void;
    onDelete: () => void;
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
    <Input value={title} oninput={(e) => commitTitle((e.target as HTMLInputElement).value)} placeholder="Step title..." class="title-input" />
    <Button variant="ghost" size="icon" onclick={onDelete} class="delete-btn">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </Button>
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
