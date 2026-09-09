<script lang="ts">
  // Replaces the old single "Theme" row that opened ThemePicker
  // directly (NoteEditorHeader/TodoHeader's Actions sheet, and
  // SettingsSheet's landing-page row). Now there are 2-3 independent
  // slots — this is the small menu of rows in between: each row shows
  // its own current swatch and, tapped, opens the SAME circular-swatch
  // ThemePicker/IconPicker as before, just scoped to that one slot.
  // Same sequential-sheet-swap pattern already used everywhere else in
  // this app (close this sheet, open the next one) — Sheet.svelte
  // doesn't support stacking.
  //
  // `icon`/`onIconChange` are only passed by per-entry callers
  // (NoteEditorHeader/TodoHeader) — SettingsSheet's landing-page theme
  // has no icon slot (see entry.ts's `icon` comment for why), so it
  // simply omits both props and the Icon row never renders. Distinguish
  // "prop omitted" (undefined -> no icon slot at all) from "icon slot
  // exists but is currently unset" (null -> slot exists, shows the
  // none-swatch) — don't default `icon` to null here, that would make
  // every landing-page usage look like it has an icon slot set to none.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ThemePicker from "$lib/components/shared/ThemePicker/ThemePicker.svelte";
  import IconPicker from "$lib/components/shared/IconPicker/IconPicker.svelte";
  import { resolveTheme, getIconGlyph } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";
  import type { ThemeRef } from "$lib/types/entry";

  let {
    open = $bindable(false),
    title = "Theme",
    headerTheme,
    bodyTheme,
    onHeaderChange,
    onBodyChange,
    icon,
    onIconChange,
    bodyAllowCustom = false,
  }: {
    open?: boolean;
    title?: string;
    headerTheme: ThemeRef;
    bodyTheme: ThemeRef;
    onHeaderChange: (theme: ThemeRef) => void;
    onBodyChange: (theme: ThemeRef) => void;
    icon?: string | null;
    onIconChange?: (icon: string | null) => void;
    // Default false: the per-entry editor body sits directly behind
    // live Tiptap caret/selection rendering, where an uploaded photo is
    // an unverified legibility risk (see entry.ts's bodyTheme comment)
    // — that's the common case (NoteEditorHeader/TodoHeader), so it's
    // the default rather than something every call site has to
    // remember to pass. SettingsSheet's landing-page body is just a
    // scrollable list background with no live-editing surface behind
    // it — the same risk profile as any header theme — so it passes
    // true to get the normal full picker (presets + uploads).
    bodyAllowCustom?: boolean;
  } = $props();

  const showIcon = $derived(icon !== undefined);

  let headerPickerOpen = $state(false);
  let bodyPickerOpen = $state(false);
  let iconPickerOpen = $state(false);

  const resolvedHeader = $derived(resolveTheme(headerTheme, customThemes));
  const resolvedBody = $derived(resolveTheme(bodyTheme, customThemes));
  const iconGlyph = $derived(getIconGlyph(icon ?? null));

  function openHeaderPicker() {
    open = false;
    headerPickerOpen = true;
  }
  function openBodyPicker() {
    open = false;
    bodyPickerOpen = true;
  }
  function openIconPicker() {
    open = false;
    iconPickerOpen = true;
  }
</script>

<Sheet bind:open side="bottom" {title}>
  <div class="sections">
    <button type="button" class="section-row" onclick={openHeaderPicker}>
      <div class="row-text">
        <span class="row-label">Header</span>
        <span class="row-desc">The card in the list, and the editor's top bar.</span>
      </div>
      <span
        class="swatch-preview"
        class:none-swatch={resolvedHeader.kind === "none"}
        style={resolvedHeader.kind === "color"
          ? `background:${resolvedHeader.color}`
          : resolvedHeader.kind === "image"
            ? `background-image:url(${resolvedHeader.dataUrl})`
            : undefined}
        aria-hidden="true"
      ></span>
    </button>

    <button type="button" class="section-row" onclick={openBodyPicker}>
      <div class="row-text">
        <span class="row-label">Body</span>
        <span class="row-desc">{bodyAllowCustom ? "The scrollable background behind the list." : "The writing area itself. Solid colors only for now."}</span>
      </div>
      <span
        class="swatch-preview"
        class:none-swatch={resolvedBody.kind === "none"}
        style={resolvedBody.kind === "color" ? `background:${resolvedBody.color}` : undefined}
        aria-hidden="true"
      ></span>
    </button>

    {#if showIcon}
      <button type="button" class="section-row" onclick={openIconPicker}>
        <div class="row-text">
          <span class="row-label">Icon</span>
          <span class="row-desc">A small badge next to the title in the list.</span>
        </div>
        <span class="swatch-preview icon-preview" class:none-swatch={!iconGlyph} aria-hidden="true">
          {iconGlyph ?? ""}
        </span>
      </button>
    {/if}
  </div>
</Sheet>

<ThemePicker bind:open={headerPickerOpen} title="Header theme" value={headerTheme} onChange={onHeaderChange} />
<ThemePicker bind:open={bodyPickerOpen} title="Body theme" value={bodyTheme} onChange={onBodyChange} allowCustom={bodyAllowCustom} />
{#if showIcon}
  <IconPicker bind:open={iconPickerOpen} title="Icon" value={icon ?? null} onChange={(v) => onIconChange?.(v)} />
{/if}

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .section-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    background: transparent;
    border: none;
    padding: 0;
    width: 100%;
    text-align: left;
    cursor: pointer;
  }
  .row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-hi);
  }
  .row-desc {
    font-size: 12px;
    color: var(--text-faint);
  }
  /* Same 28px circular swatch as the old SettingsSheet theme row — same
     picker family, same look, carried over unchanged. */
  .swatch-preview {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background-color: var(--surface);
    background-size: cover;
    background-position: center;
    flex-shrink: 0;
  }
  .swatch-preview.none-swatch {
    background: linear-gradient(45deg, transparent 47%, var(--text-faint) 47%, var(--text-faint) 53%, transparent 53%), var(--surface);
  }
  .icon-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    line-height: 1;
  }
</style>
