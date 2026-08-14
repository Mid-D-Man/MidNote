<script lang="ts">
  import Card from "$lib/components/ui/Card/Card.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";
  import Textarea from "$lib/components/ui/Textarea/Textarea.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";

  let {
    title,
    content,
    onUpdate,
    onDelete,
  }: {
    title: string;
    content: string;
    onUpdate: (title: string, content: string) => void;
    onDelete: () => void;
  } = $props();
</script>

<Card class="annotation-card">
  <div class="row">
    <Input
      value={title}
      oninput={(e) => onUpdate((e.target as HTMLInputElement).value, content)}
      placeholder="Note title..."
      class="title-input"
    />
    <Button variant="ghost" size="icon" onclick={onDelete} class="delete-btn">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </Button>
  </div>
  <Textarea
    value={content}
    oninput={(e) => onUpdate(title, (e.currentTarget as HTMLTextAreaElement).value)}
    placeholder="Write your note..."
    minHeight="80px"
  />
</Card>

<style>
  :global(.annotation-card) {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  :global(.annotation-card .title-input) {
    flex: 1;
    min-width: 0;
    font-size: 12px;
  }
  :global(.annotation-card .delete-btn) {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
  }
</style>
