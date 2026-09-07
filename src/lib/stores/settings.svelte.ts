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

// Ruled-paper background lines in the note editor (see NoteContent.svelte).
// Defaults OFF: it's a new, real-device-unverified visual change, safer
// to let people opt in from Settings than to change everyone's editor
// look by default.
const NOTE_LINES_KEY = "midnote:note-lines";

function loadNoteLinesEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(NOTE_LINES_KEY) === "true";
}

export const noteLinesEnabled = $state({ value: loadNoteLinesEnabled() });

export function setNoteLinesEnabled(enabled: boolean) {
  noteLinesEnabled.value = enabled;
  if (typeof localStorage !== "undefined") localStorage.setItem(NOTE_LINES_KEY, String(enabled));
}

// Landing-page theme — the list/notes-and-todos page's own background,
// set from Settings. Deliberately separate from any single entry's
// `theme` field (entry.ts): a note/todo's own theme, when set, overrides
// this for that one card/editor; this is just the default the landing
// page itself paints with. Same {kind,name,customThemeId} pointer shape
// as an entry's theme — see themePalette.ts's resolveTheme, which both
// consume identically.
import type { ThemeRef } from "$lib/types/entry";
import { NO_THEME } from "$lib/types/entry";

const APP_THEME_KEY = "midnote:app-theme";

function loadAppTheme(): ThemeRef {
  if (typeof localStorage === "undefined") return { ...NO_THEME };
  try {
    const raw = localStorage.getItem(APP_THEME_KEY);
    if (!raw) return { ...NO_THEME };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") return parsed as ThemeRef;
    return { ...NO_THEME };
  } catch {
    return { ...NO_THEME };
  }
}

export const appTheme = $state<{ value: ThemeRef }>({ value: loadAppTheme() });

export function setAppTheme(theme: ThemeRef) {
  appTheme.value = theme;
  if (typeof localStorage !== "undefined") localStorage.setItem(APP_THEME_KEY, JSON.stringify(theme));
}
