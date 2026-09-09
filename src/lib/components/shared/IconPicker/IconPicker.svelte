<script lang="ts">
  // Sibling to ThemePicker.svelte, deliberately kept as close to its
  // shape as possible — same Sheet-with-circular-swatch-grid pattern,
  // just picking a glyph name instead of a ThemeRef. One picker, reused
  // by NoteEditorHeader/TodoHeader's Theme & Icon sheet — see
  // ThemeSectionsSheet.svelte, which is the only current caller.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { ICON_PRESETS } from "$lib/utils/themePalette";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let {
    open = $bindable(false),
    title = "Icon",
    value,
    onChange,
  }: {
    open?: boolean;
    title?: string;
    value: string | null;
    onChange: (icon: string | null) => void;
  } = $props();

  function pick(name: string) {
    breadcrumb(`icon picker: "${name}" selected`);
    onChange(name === "none" ? null : name);
    open = false;
  }
</script>

<Sheet bind:open side="bottom" {title}>
  <div class="picker">
    <div class="swatch-grid">
      {#each ICON_PRESETS as preset (preset.name)}
        <button
          type="button"
          class="swatch"
          class:active={preset.name === "none" ? value === null : value === preset.name}
          class:none-swatch={preset.glyph === null}
          aria-label={preset.label}
          title={preset.label}
          onclick={() => pick(preset.name)}
        >
          {#if preset.glyph}
            <span aria-hidden="true">{preset.glyph}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
</Sheet>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .swatch-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
  }
  /* Same 44px circular swatch as ThemePicker — same picker family,
     same look, just a centered glyph instead of a background color. */
  .swatch {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background: var(--surface);
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
</style>
