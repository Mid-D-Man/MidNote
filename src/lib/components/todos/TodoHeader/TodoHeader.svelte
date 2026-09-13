<script lang="ts">
  import { goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog/ConfirmDialog.svelte";
  import TagSelector from "$lib/components/shared/TagSelector/TagSelector.svelte";
  import ThemeSectionsSheet from "$lib/components/shared/ThemeSectionsSheet/ThemeSectionsSheet.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { removeEntry, saveEntry } from "$lib/stores/entries.svelte";
  import { createTodo } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { resolveTheme, hexToRgba, getImageTextColorVars } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import type { Todo, ThemeRef } from "$lib/types/entry";

  let {
    todo,
    availableTags,
    onTagsChange,
    onSave,
    onBack,
    onShowNotes,
  }: {
    todo: Todo;
    availableTags: string[];
    onTagsChange: (tags: string[]) => void;
    onSave: () => void;
    onBack: () => void;
    onShowNotes: () => void;
  } = $props();

  let isSaving = $state(false);
  let showDeleteConfirm = $state(false);
  // REVISION: Actions moved from a DropdownMenu into a bottom Sheet,
  // Share folded in alongside Duplicate/Download instead of its own
  // standalone row-level icon — brings this header to the same
  // structure NoteEditorHeader already uses, which is also what makes
  // "the theme picker lives in the same place as Share" (direct
  // request) actually true for todos, not just notes: before this,
  // Share and Duplicate/Download lived in two different places on this
  // specific header, so there was no single "same place as Share" to
  // put Theme into without picking one first.
  let moreOpen = $state(false);
  let themeSheetOpen = $state(false);

  const resolvedHeaderTheme = $derived(resolveTheme(todo.headerTheme, customThemes));
  const headerStyle = $derived(
    resolvedHeaderTheme.kind === "color"
      ? `background: ${hexToRgba(resolvedHeaderTheme.color, 0.14)}; border-bottom-color: ${resolvedHeaderTheme.color};`
      : resolvedHeaderTheme.kind === "image"
        ? // Same fix as NoteEditorHeader.svelte's identical headerStyle
          // — see that file's comment for the full reasoning.
          `background-image: linear-gradient(rgba(4,6,16,0.35), rgba(4,6,16,0.35)), url(${resolvedHeaderTheme.dataUrl}); background-size: cover; background-position: center; ${getImageTextColorVars(resolvedHeaderTheme.textColor)}`
        : "",
  );

  function handleOpenThemeSheet() {
    breadcrumb("todo header: Theme tapped");
    moreOpen = false;
    themeSheetOpen = true;
  }

  // BUGFIX — see NoteEditorHeader.svelte's identical comment: `todo`
  // here is /todo/[id]/+page.svelte's own local $state (loaded via
  // getEntry()), a different object from the entries store's array
  // item. The old setEntryTheme(todo.id, theme) mutated the wrong one.
  function handleHeaderThemeChange(theme: ThemeRef) {
    todo.headerTheme = theme;
    saveEntry(todo);
  }
  function handleBodyThemeChange(theme: ThemeRef) {
    todo.bodyTheme = theme;
    saveEntry(todo);
  }
  function handleIconChange(icon: string | null) {
    todo.icon = icon;
    saveEntry(todo);
  }

  async function handleSave() {
    isSaving = true;
    onSave();
    pushToast({ title: "Todo saved", description: "Your todo has been saved successfully." });
    setTimeout(() => (isSaving = false), 400);
  }

  function handleBack() {
    onSave();
    onBack();
  }

  // BUGFIX (data-safety) — same fix as NoteEditorHeader.svelte's
  // identical handleDeleteTapped; see that file's comment for why this
  // icon needs its own gate despite the landing-page list already being
  // gated (direct navigation to a locked todo's editor route skips
  // that).
  function handleDeleteTapped() {
    breadcrumb(`todo header: Delete icon tapped (encrypted=${todo.encrypted})`);
    if (todo.encrypted) {
      pushToast({ title: "Unlock first", description: "Unlock this todo before deleting it.", variant: "destructive" });
      return;
    }
    showDeleteConfirm = true;
  }

  function handleDelete() {
    removeEntry(todo.id);
    pushToast({ title: "Todo deleted", description: "Your todo has been deleted.", variant: "destructive" });
    goto("/");
  }

  function handleDuplicate() {
    moreOpen = false;
    const copy = createTodo();
    copy.title = `${todo.title} (Copy)`;
    copy.tags = [...todo.tags];
    copy.categories = [...todo.categories];
    copy.steps = todo.steps.map((s) => ({ ...s, id: crypto.randomUUID() }));
    copy.annotations = todo.annotations.map((a) => ({ ...a, id: crypto.randomUUID() }));
    saveEntry(copy);
    goto(`/todo/${copy.id}`);
    pushToast({ title: "Todo duplicated", description: "Your todo has been duplicated." });
  }

  function handleDownload() {
    let content = `${todo.title}\n\n`;
    for (const step of todo.steps) content += `${step.title}\n${step.content}\n\n`;
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${todo.title || "todo"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    pushToast({ title: "Todo downloaded", description: "Your todo has been downloaded as a text file." });
  }

  async function handleShare() {
    moreOpen = false;
    pushToast({ title: "Share todo", description: "Share functionality coming soon." });
  }
</script>

<header class="todo-header" style={headerStyle}>
  <div class="row">
    <Button variant="ghost" size="icon" onclick={handleBack}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
    </Button>

    <div class="actions">
      <Button variant="ghost" size="icon" onclick={onShowNotes}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </Button>

      <Button variant="ghost" size="icon" onclick={handleDeleteTapped}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </Button>

      <Button variant="ghost" size="icon" onclick={handleSave} disabled={isSaving}>
        {#if isSaving}
          <Spinner />
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
        {/if}
      </Button>

      <Button variant="ghost" size="icon" onclick={() => (moreOpen = true)} aria-label="More">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      </Button>
    </div>
  </div>

  <TagSelector
    selectedTags={todo.tags}
    {availableTags}
    onAddTag={(t) => onTagsChange([...todo.tags, t])}
    onRemoveTag={(t) => onTagsChange(todo.tags.filter((x) => x !== t))}
  />
</header>

<Sheet bind:open={moreOpen} side="bottom" title="Actions">
  <div class="action-list">
    <button class="action-row" onclick={handleShare}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
      </svg>
      <span>Share</span>
    </button>
    <button class="action-row" onclick={handleDuplicate}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span>Duplicate</span>
    </button>
    <button class="action-row" onclick={handleDownload}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
      </svg>
      <span>Download as text</span>
    </button>
    <button class="action-row" onclick={handleOpenThemeSheet}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9" /><path d="M12 3a6 6 0 0 0 0 12 3 3 0 0 1 0 6 9 9 0 1 1 0-18z" />
        <circle cx="7.5" cy="10.5" r="1" fill="currentColor" /><circle cx="12" cy="7.5" r="1" fill="currentColor" /><circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
      </svg>
      <span>Theme</span>
    </button>
  </div>
</Sheet>

<ThemeSectionsSheet
  bind:open={themeSheetOpen}
  title="Theme &amp; Icon"
  headerTheme={todo.headerTheme}
  bodyTheme={todo.bodyTheme}
  icon={todo.icon}
  onHeaderChange={handleHeaderThemeChange}
  onBodyChange={handleBodyThemeChange}
  onIconChange={handleIconChange}
/>

<ConfirmDialog
  bind:open={showDeleteConfirm}
  title="Delete todo"
  description="Are you sure you want to delete this todo? This can't be undone."
  confirmLabel="Delete"
  danger
  onconfirm={handleDelete}
/>

<style>
  .todo-header {
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .action-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .action-row {
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
  .action-row:hover {
    background: var(--surface-raised);
  }
</style>
