<script lang="ts">
  // Round 42 — the little circle that previews the landing page's header theme
  // (the one visible everywhere at a glance — the tab bar). Used on the Theme
  // rows of the Settings panel and of Settings -> Appearance.
  import { appHeaderTheme } from "$lib/stores/settings.svelte";
  import { resolveTheme } from "$lib/utils/themePalette";
  import { customThemes } from "$lib/stores/customThemes.svelte";

  const resolved = $derived(resolveTheme(appHeaderTheme.value, customThemes));
</script>

<span
  class="theme-swatch"
  class:none-swatch={resolved.kind === "none"}
  style={resolved.kind === "color" ? `background:${resolved.color}` : resolved.kind === "image" ? `background-image:url(${resolved.dataUrl})` : undefined}
  aria-hidden="true"
></span>

<style>
  .theme-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--hairline);
    background-color: var(--surface);
    background-size: cover;
    background-position: center;
    flex-shrink: 0;
  }
  .theme-swatch.none-swatch {
    background: linear-gradient(45deg, transparent 47%, var(--text-faint) 47%, var(--text-faint) 53%, transparent 53%), var(--surface);
  }
</style>
