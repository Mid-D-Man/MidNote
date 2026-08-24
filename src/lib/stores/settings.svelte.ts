// App-wide display/behavior settings.
//
// fontSize: the note body's BASE size — the default a note starts at
// and what the size picker falls back to when the caret isn't sitting
// inside a locally-overridden span. It is NOT what the formatting
// toolbar's size buttons write to anymore — those apply a per-selection
// / per-typing-position override instead (see richText.ts's
// applyFontSize), which is the actual fix for "changing the size
// changed the whole note" rather than just the part being edited.
//
// debugPanelVisible: whether the floating debug panel (see
// components/debug/DebugPanel.svelte) renders at all. Global capture
// (console.error/warn interception, breadcrumbs) always keeps running
// regardless of this — it's cheap and the history since app start stays
// useful if this gets flipped back on — only the panel's own UI is
// gated by it. Surfaced from the burger menu's Settings sheet.
const FONT_SIZE_KEY = "midnote:font-size";
const DEFAULT_SIZE = 15;
const SIZES = [10, 12, 14, 15, 16, 18, 20, 24] as const;

function loadFontSize(): number {
  if (typeof localStorage === "undefined") return DEFAULT_SIZE;
  const raw = localStorage.getItem(FONT_SIZE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return SIZES.includes(n as (typeof SIZES)[number]) ? n : DEFAULT_SIZE;
}

export const fontSize = $state({ value: loadFontSize() });

export function setFontSize(size: number) {
  fontSize.value = size;
  if (typeof localStorage !== "undefined") localStorage.setItem(FONT_SIZE_KEY, String(size));
}

export const FONT_SIZES = SIZES;

const DEBUG_PANEL_KEY = "midnote:debug-panel-visible";

function loadDebugPanelVisible(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(DEBUG_PANEL_KEY);
  // No stored value yet -> default ON, matching the panel's current
  // always-on behavior so existing on-device debugging workflow doesn't
  // silently change until someone actually opens Settings and flips it.
  return raw === null ? true : raw === "true";
}

export const debugPanelVisible = $state({ value: loadDebugPanelVisible() });

export function setDebugPanelVisible(visible: boolean) {
  debugPanelVisible.value = visible;
  if (typeof localStorage !== "undefined") localStorage.setItem(DEBUG_PANEL_KEY, String(visible));
}
