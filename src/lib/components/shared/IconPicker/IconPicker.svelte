<script lang="ts">
  // Sibling to ThemePicker.svelte, deliberately kept as close to its
  // shape as possible — same Sheet-with-circular-swatch-grid pattern,
  // plus its own "Your uploads" section for a small custom image
  // instead of only a curated glyph set. One picker, reused by
  // NoteEditorHeader/TodoHeader's Theme & Icon sheet — see
  // ThemeSectionsSheet.svelte, which is the only current caller.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { ICON_PRESETS } from "$lib/utils/themePalette";
  import { customIcons, addCustomIcon, removeCustomIcon } from "$lib/stores/customIcons.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { IconRef } from "$lib/types/entry";

  let {
    open = $bindable(false),
    title = "Icon",
    value,
    onChange,
  }: {
    open?: boolean;
    title?: string;
    value: IconRef | null;
    onChange: (icon: IconRef | null) => void;
  } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);

  function pickPreset(name: string) {
    breadcrumb(`icon picker: preset "${name}" selected`);
    onChange(name === "none" ? null : { kind: "preset", name });
    open = false;
  }

  function pickCustom(id: string) {
    breadcrumb(`icon picker: custom icon "${id}" selected`);
    onChange({ kind: "custom", customIconId: id });
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
      breadcrumb(`icon picker: uploaded custom icon "${icon.id}"`);
      onChange({ kind: "custom", customIconId: icon.id });
      open = false;
    } catch (err) {
      console.error("icon picker: upload failed:", err);
      pushToast({ title: "Couldn't add that image", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = "";
    }
  }

  function handleDeleteCustom(e: MouseEvent, id: string) {
    e.stopPropagation();
    breadcrumb(`icon picker: delete custom icon "${id}"`);
    // Same reasoning as ThemePicker's identical guard: if the icon being
    // deleted is the one currently applied here, fall back to no icon
    // rather than leaving a dangling reference — resolveIcon() already
    // handles a dangling reference gracefully, but resetting explicitly
    // means this picker's own highlighted swatch stays honest
    // immediately rather than until next reload.
    if (value?.kind === "custom" && value.customIconId === id) {
      onChange(null);
    }
    removeCustomIcon(id);
  }
</script>

<Sheet bind:open side="bottom" {title}>
  <div class="picker">
    <div class="section-label">Presets</div>
    <div class="swatch-grid">
      {#each ICON_PRESETS as preset (preset.name)}
        <button
          type="button"
          class="swatch"
          class:active={preset.name === "none" ? value === null : value?.kind === "preset" && value.name === preset.name}
          class:none-swatch={preset.glyph === null}
          aria-label={preset.label}
          title={preset.label}
          onclick={() => pickPreset(preset.name)}
        >
          {#if preset.glyph}
            <span aria-hidden="true">{preset.glyph}</span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="section-label">Your uploads</div>
    <p class="upload-hint">Any photo works — it's center-cropped to a square and shrunk to a small badge before saving.</p>
    <div class="swatch-grid">
      {#each customIcons as ci (ci.id)}
        <div class="custom-swatch-wrap">
          <button
            type="button"
            class="swatch custom-swatch"
            class:active={value?.kind === "custom" && value.customIconId === ci.id}
            style={`background-image:url(${ci.data})`}
            aria-label="Uploaded icon"
            onclick={() => pickCustom(ci.id)}
          ></button>
          <button type="button" class="remove-custom" aria-label="Delete this uploaded icon" onclick={(e) => handleDeleteCustom(e, ci.id)}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
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
  </div>
</Sheet>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: var(--space-2);
  }
  .section-label:first-child {
    margin-top: 0;
  }
  .upload-hint {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-faint);
    margin: 0 0 var(--space-1) 0;
  }
  .swatch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
  }
  /* Same 44px circular swatch as ThemePicker — same picker family, same
     look, just a centered glyph or a background image instead of a flat
     color. */
  .swatch {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background: var(--surface);
    background-size: cover;
    background-position: center;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    line-height: 1;
  }
  .swatch.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-wash);
  }
  .swatch.none-swatch {
    background: linear-gradient(45deg, transparent 47%, var(--text-faint) 47%, var(--text-faint) 53%, transparent 53%), var(--surface);
  }
  .custom-swatch-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .remove-custom {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--danger);
    color: var(--bg);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .upload-tile {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px dashed var(--hairline);
    background: transparent;
    color: var(--text-faint);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }
  .upload-tile:hover:not(:disabled) {
    border-color: var(--accent-dim);
    color: var(--text-hi);
  }
  .upload-tile:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .file-input {
    display: none;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    border-top-color: var(--text-hi);
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
