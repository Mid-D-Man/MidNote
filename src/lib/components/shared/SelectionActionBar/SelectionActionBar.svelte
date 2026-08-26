<script lang="ts">
  import Button from "$lib/components/ui/Button/Button.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import DropdownMenu from "$lib/components/ui/DropdownMenu/DropdownMenu.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { ExportFormat } from "$lib/utils/selectionActions";

  let {
    selectedCount,
    itemLabel,
    canMerge,
    onCancel,
    onDelete,
    onSend,
    onMerge,
    onExport,
  }: {
    selectedCount: number;
    // "note" or "todo" — only used for copy ("3 notes selected").
    itemLabel: string;
    canMerge: boolean;
    onCancel: () => void;
    onDelete: () => void;
    onSend: () => void;
    onMerge: () => void;
    onExport: (format: ExportFormat) => void;
  } = $props();

  let showDeleteConfirm = $state(false);

  function confirmDelete() {
    breadcrumb(`selection bar: delete confirmed (${selectedCount} items)`);
    onDelete();
  }
</script>

<div class="bar">
  <button class="cancel" onclick={onCancel} aria-label="Cancel selection">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  </button>

  <span class="count">{selectedCount} {itemLabel}{selectedCount === 1 ? "" : "s"} selected</span>

  <div class="actions">
    <Button
      variant="ghost"
      size="icon"
      onclick={() => {
        breadcrumb("selection bar: Send tapped");
        onSend();
      }}
      aria-label="Send"
      disabled={selectedCount === 0}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
      </svg>
    </Button>

    <Button
      variant="ghost"
      size="icon"
      onclick={() => {
        breadcrumb("selection bar: Merge tapped");
        onMerge();
      }}
      aria-label="Merge"
      disabled={!canMerge}
      title={canMerge ? "Merge selected" : "Select 2+ items of the same type to merge"}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 3v12a3 3 0 0 0 3 3h6" /><path d="m15 6 3-3 3 3" /><path d="M18 3v18" />
      </svg>
    </Button>

    <DropdownMenu align="end">
      {#snippet trigger(toggle)}
        <Button
          variant="ghost"
          size="icon"
          onclick={() => {
            breadcrumb("selection bar: Export menu opened");
            toggle();
          }}
          aria-label="Export"
          disabled={selectedCount === 0}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
          </svg>
        </Button>
      {/snippet}
      <button class="menu-item" onclick={() => onExport("separate")}>Separate files</button>
      <button class="menu-item" onclick={() => onExport("combined")}>One combined file</button>
      <button class="menu-item" onclick={() => onExport("zip")}>Zip archive</button>
    </DropdownMenu>

    <Button
      variant="ghost"
      size="icon"
      onclick={() => {
        breadcrumb("selection bar: Delete icon tapped (confirm dialog opening)");
        showDeleteConfirm = true;
      }}
      aria-label="Delete"
      disabled={selectedCount === 0}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </Button>
  </div>
</div>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete {selectedCount} {itemLabel}{selectedCount === 1 ? '' : 's'}"
  description="This can't be undone."
  confirmLabel="Delete"
  danger
  onconfirm={confirmDelete}
/>

<style>
  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 45;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
    background: var(--surface-raised);
    border-top: 1px solid var(--hairline);
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.28);
  }
  .cancel {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
  }
  .cancel:hover {
    background: var(--surface);
  }
  .count {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text-hi);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 13px;
    cursor: pointer;
  }
  .menu-item:hover {
    background: var(--surface);
  }
</style>
