<!--
  Opened by BoardCanvas when a node is tapped. Local edit buffer, not a
  two-way bind straight to the node: typing shouldn't persist a
  half-finished edit on every keystroke (which would also mean every
  keystroke re-emits the whole board up to storage) — "Done" is the one
  actual commit point, same shape as every other edit-then-confirm sheet
  in the app (ThemeSectionsSheet, PagesPanel's rename).

  Image picking reuses the SAME customIcons registry and upload flow as
  IconPicker.svelte (center-crop + downscale, deduped storage) rather
  than inventing a second one — see entry.ts's BoardNode.customIconId
  comment for why.
-->
<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { customIcons, addCustomIcon } from "$lib/stores/customIcons.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { BoardNode } from "$lib/types/entry";

  let {
    open = $bindable(false),
    node,
    onSave,
    onDelete,
  }: {
    open?: boolean;
    node: BoardNode | null;
    onSave: (patch: { label: string; body: string | null; customIconId: string | null }) => void;
    onDelete: () => void;
  } = $props();

  let label = $state("");
  let body = $state("");
  let customIconId = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);

  // Reseed the local buffer whenever a (different) node opens. Keyed on
  // node?.id rather than the whole node object, which would re-run this
  // on every field change too and stomp whatever the person just typed.
  let seededFor = $state<string | null>(null);
  $effect(() => {
    if (node && node.id !== seededFor) {
      label = node.label;
      body = node.body ?? "";
      customIconId = node.customIconId;
      seededFor = node.id;
    }
  });

  function commit() {
    if (!node) return;
    breadcrumb(`board node edit: Done tapped, kind=${node.kind}`);
    onSave({
      label: label.trim() || (node.kind === "image" ? "Image" : "Untitled"),
      body: node.kind === "text" ? body.trim() || null : null,
      customIconId,
    });
    open = false;
  }

  function handleDelete() {
    breadcrumb("board node edit: Delete tapped");
    onDelete();
    open = false;
  }

  async function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast({ title: "Not an image", description: "Pick a photo or image file.", variant: "destructive" });
      return;
    }
    uploading = true;
    try {
      const icon = await addCustomIcon(file);
      customIconId = icon.id;
      breadcrumb(`board node edit: uploaded image "${icon.id}"`);
    } catch (err) {
      console.error("board node edit: image upload failed:", err);
      pushToast({ title: "Couldn't add that image", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = "";
    }
  }
</script>

<Sheet bind:open side="bottom" title={node?.kind === "image" ? "Image node" : "Text node"}>
  {#if node}
    <div class="edit-form">
      <label class="field">
        <span class="field-label">Label</span>
        <input type="text" bind:value={label} placeholder="Label" />
      </label>

      {#if node.kind === "text"}
        <label class="field">
          <span class="field-label">Body</span>
          <textarea bind:value={body} placeholder="Optional details..." rows="4"></textarea>
        </label>
      {:else}
        <div class="field">
          <span class="field-label">Image</span>
          <div class="swatch-grid">
            {#each customIcons as ci (ci.id)}
              <button
                type="button"
                class="swatch"
                class:active={customIconId === ci.id}
                style="background-image:url({ci.data})"
                aria-label="Use this image"
                onclick={() => (customIconId = ci.id)}
              ></button>
            {/each}
            <button type="button" class="upload-tile" disabled={uploading} onclick={() => fileInput?.click()}>
              {#if uploading}
                <span class="spinner" aria-hidden="true"></span>
              {:else}
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              {/if}
            </button>
            <input bind:this={fileInput} type="file" accept="image/*" class="file-input" onchange={handleFileChange} />
          </div>
          {#if customIcons.length === 0}
            <p class="hint">No images uploaded yet — tap + to add one.</p>
          {/if}
        </div>
      {/if}

      <div class="button-row">
        <!-- No confirmation dialog: unlike deleting a whole entry
             (ConfirmDialog everywhere else in the app), a single node is
             a much smaller, more disposable unit — closer to deleting a
             todo step than deleting a note. Styled distinctly (red) so
             it still reads as a real, deliberate action. -->
        <button class="delete-btn" onclick={handleDelete}>Delete node</button>
        <button class="save-btn" onclick={commit}>Done</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input[type="text"],
  textarea {
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    color: var(--text-hi);
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
  }
  input[type="text"]:focus,
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
  .swatch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .swatch,
  .upload-tile {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-sm);
    border: 2px solid transparent;
    background-color: var(--surface-raised);
    background-size: cover;
    background-position: center;
    cursor: pointer;
  }
  .swatch.active {
    border-color: var(--accent);
  }
  .upload-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--hairline);
    color: var(--text-lo);
  }
  .upload-tile:disabled {
    opacity: 0.6;
  }
  .file-input {
    display: none;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--text-faint);
    border-top-color: var(--text-hi);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .button-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .delete-btn,
  .save-btn {
    flex: 1;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .delete-btn {
    background: var(--danger-wash);
    border-color: var(--danger);
    color: var(--danger);
  }
  .save-btn {
    background: var(--accent);
    color: #fff;
  }
</style>
