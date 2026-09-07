<script lang="ts">
  // Shared by NoteEditorHeader/TodoHeader (per-entry theme, opened from
  // the same Actions sheet as Share/Duplicate) and SettingsSheet
  // (landing-page theme). Same reasoning as ColorSwatchPicker being
  // reused for text/background color: one picker, the title and
  // value/onChange passed in differ per call site, the picker itself
  // doesn't care what it's theming.
  //
  // Own Sheet rather than an anchored popup (unlike FontSizePicker/
  // ColorSwatchPicker, which anchor above the persistent formatting
  // toolbar) — this is triggered from inside another Sheet's Actions
  // list, not from a toolbar, so it follows CardOverflowMenu's existing
  // pattern instead: close the sheet you're in, open this one.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { THEME_PRESETS } from "$lib/utils/themePalette";
  import { customThemes, addCustomTheme, removeCustomTheme } from "$lib/stores/customThemes.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { ThemeRef } from "$lib/types/entry";

  let {
    open = $bindable(false),
    title = "Theme",
    value,
    onChange,
  }: {
    open?: boolean;
    title?: string;
    value: ThemeRef;
    onChange: (theme: ThemeRef) => void;
  } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);

  function pickPreset(name: string) {
    breadcrumb(`theme picker: preset "${name}" selected`);
    onChange({ kind: "preset", name, customThemeId: null });
    open = false;
  }

  function pickCustom(id: string) {
    breadcrumb(`theme picker: custom theme "${id}" selected`);
    onChange({ kind: "custom", name: null, customThemeId: id });
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
      const theme = await addCustomTheme(file);
      breadcrumb(`theme picker: uploaded custom theme "${theme.id}"`);
      onChange({ kind: "custom", name: null, customThemeId: theme.id });
      open = false;
    } catch (err) {
      console.error("theme picker: upload failed:", err);
      pushToast({ title: "Couldn't add that image", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = "";
    }
  }

  function handleDeleteCustom(e: MouseEvent, id: string) {
    e.stopPropagation();
    breadcrumb(`theme picker: delete custom theme "${id}"`);
    // If the theme being deleted is the one currently applied here,
    // fall back to no theme rather than leaving a dangling reference —
    // resolveTheme() already handles a dangling reference gracefully,
    // but resetting explicitly means the picker's own highlighted
    // swatch stays honest immediately rather than until next reload.
    if (value.kind === "custom" && value.customThemeId === id) {
      onChange({ kind: "preset", name: "none", customThemeId: null });
    }
    removeCustomTheme(id);
  }
</script>

<Sheet bind:open side="bottom" {title}>
  <div class="picker">
    <div class="section-label">Presets</div>
    <div class="swatch-grid">
      {#each THEME_PRESETS as preset (preset.name)}
        <button
          type="button"
          class="swatch"
          class:active={value.kind === "preset" && value.name === preset.name}
          class:none-swatch={preset.color === null}
          style={preset.color ? `background:${preset.color}` : undefined}
          aria-label={preset.label}
          title={preset.label}
          onclick={() => pickPreset(preset.name)}
        ></button>
      {/each}
    </div>

    <div class="section-label">Your uploads</div>
    <div class="swatch-grid">
      {#each customThemes as ct (ct.id)}
        <div class="custom-swatch-wrap">
          <button
            type="button"
            class="swatch custom-swatch"
            class:active={value.kind === "custom" && value.customThemeId === ct.id}
            style={`background-image:url(${ct.data})`}
            aria-label="Uploaded theme"
            onclick={() => pickCustom(ct.id)}
          ></button>
          <button type="button" class="remove-custom" aria-label="Delete this uploaded theme" onclick={(e) => handleDeleteCustom(e, ct.id)}>
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
  .swatch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
  }
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
