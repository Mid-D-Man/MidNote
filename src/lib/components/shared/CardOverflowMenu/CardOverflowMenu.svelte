<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let {
    itemLabel,
    struck = false,
    onDelete,
    onDownload,
    onToggleStrikethrough,
  }: {
    // "note" or "todo" — copy only ("Delete note?").
    itemLabel: string;
    struck?: boolean;
    onDelete: () => void;
    onDownload: () => void;
    onToggleStrikethrough: () => void;
  } = $props();

  let open = $state(false);
  let showDeleteConfirm = $state(false);

  // Sheet, not a positioned dropdown — deliberately, same reasoning as
  // Export's menu: this trigger can end up anywhere in a scrolling grid,
  // including right at the bottom edge of the viewport, which is
  // exactly the position a dropdown can't reliably escape (see
  // DropdownMenu.svelte's own header comment). A bottom sheet has
  // nowhere to clip to.
  function openMenu(e: Event) {
    e.stopPropagation();
    breadcrumb(`card overflow: opened (${itemLabel})`);
    open = true;
  }

  function pick(action: () => void, label: string) {
    breadcrumb(`card overflow: ${label} tapped (${itemLabel})`);
    open = false;
    action();
  }
</script>

<button
  class="trigger"
  onclick={openMenu}
  onpointerdown={(e) => e.stopPropagation()}
  aria-label="More options"
>
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
</button>

<Sheet bind:open side="bottom" title="Options">
  <div class="menu-list">
    <button class="menu-item" onclick={() => pick(onToggleStrikethrough, "strikethrough")}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="4" y1="12" x2="20" y2="12" />
        <path d="M16 6.5c-.9-1-2.3-1.5-4-1.5-2.5 0-4.5 1.2-4.5 3.2 0 1.3.9 2.1 2.2 2.6" />
        <path d="M9 16.5c.7 1.4 2.3 2 4.2 2 2.5 0 4.3-1.1 4.3-3" />
      </svg>
      <span>{struck ? "Remove strikethrough" : "Strikethrough"}</span>
    </button>
    <button class="menu-item" onclick={() => pick(onDownload, "download")}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
      </svg>
      <span>Download</span>
    </button>
    <button
      class="menu-item danger"
      onclick={() => {
        breadcrumb(`card overflow: delete tapped, confirm opening (${itemLabel})`);
        open = false;
        showDeleteConfirm = true;
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
      <span>Delete</span>
    </button>
  </div>
</Sheet>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete this {itemLabel}?"
  description="This can't be undone."
  confirmLabel="Delete"
  danger
  onconfirm={() => {
    breadcrumb(`card overflow: delete confirmed (${itemLabel})`);
    onDelete();
  }}
/>

<style>
  .trigger {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-faint);
    cursor: pointer;
    flex-shrink: 0;
  }
  .trigger:hover {
    background: var(--surface-raised);
    color: var(--text-hi);
  }
  .menu-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    text-align: left;
    padding: var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 14px;
    cursor: pointer;
  }
  .menu-item:hover {
    background: var(--surface-raised);
  }
  .menu-item svg {
    flex-shrink: 0;
  }
  .menu-item.danger {
    color: var(--danger);
  }
</style>
