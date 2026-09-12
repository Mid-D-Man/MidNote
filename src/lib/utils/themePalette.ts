// Bundled preset palette — themes.mdix's theme_preset(name) is only ever
// a name pointer; nothing about a preset's actual color lives in
// DixScript ("resolves by name against assets bundled in the app itself"
// per that file's own header comment). This is where that resolution
// actually happens. Solid colors only for now, per direct request —
// gradients/images-as-presets are a later addition, not this one.
//
// "none" is a real preset name (matches the schema seed data's
// Themes.theme_preset("none")), not a null/undefined theme — see
// entry.ts's NO_THEME. It resolves to `color: null`, meaning "don't
// override the surface's default background at all."
import type { CustomTheme, ThemeRef } from "$lib/types/entry";

export interface ThemePreset {
  name: string;
  label: string;
  // Hex color, or null for "none" (no override — card/editor keeps its
  // normal --surface background).
  color: string | null;
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: "none", label: "None", color: null },
  { name: "sunset", label: "Sunset", color: "#f97316" },
  { name: "ocean", label: "Ocean", color: "#0ea5e9" },
  { name: "forest", label: "Forest", color: "#22c55e" },
  { name: "berry", label: "Berry", color: "#ec4899" },
  { name: "sun", label: "Sun", color: "#eab308" },
  { name: "lavender", label: "Lavender", color: "#a78bfa" },
  { name: "slate", label: "Slate", color: "#64748b" },
];

export function getPresetColor(name: string): string | null {
  return THEME_PRESETS.find((p) => p.name === name)?.color ?? null;
}

// Per-entry icon badge — a small glyph shown next to a note/todo's
// title on its card (see requested_redesign's "icon_per_entry"). Kept
// as a plain curated emoji set rather than an uploaded-image asset (like
// custom theme images are): it's a tiny badge, not a background, so
// there's nothing to downscale/decode, and emoji render natively and
// consistently across the Android system WebView with zero bundled
// assets. entry.ts's `icon` field stores just the `name` below (or
// null for no icon); the actual glyph is looked up here at render time,
// same "pointer, not the value" shape ThemeRef already uses for presets.
// This list is a starting curation, not a hard schema — add/remove
// entries here freely, nothing else needs to change to support it.
export interface IconPreset {
  name: string;
  label: string;
  // Emoji glyph, or null for "none" (matches THEME_PRESETS's "none"
  // shape — a real preset entry, not a missing/undefined icon).
  glyph: string | null;
}

export const ICON_PRESETS: IconPreset[] = [
  { name: "none", label: "None", glyph: null },
  { name: "idea", label: "Idea", glyph: "💡" },
  { name: "important", label: "Important", glyph: "⭐" },
  { name: "urgent", label: "Urgent", glyph: "🔥" },
  { name: "work", label: "Work", glyph: "💼" },
  { name: "personal", label: "Personal", glyph: "❤️" },
  { name: "home", label: "Home", glyph: "🏠" },
  { name: "study", label: "Study", glyph: "🎓" },
  { name: "shopping", label: "Shopping", glyph: "🛒" },
  { name: "money", label: "Money", glyph: "💰" },
  { name: "health", label: "Health", glyph: "🩺" },
  { name: "travel", label: "Travel", glyph: "✈️" },
  { name: "goal", label: "Goal", glyph: "🎯" },
  { name: "celebrate", label: "Celebrate", glyph: "🎉" },
];

export function getIconGlyph(name: string | null | undefined): string | null {
  if (!name) return null;
  return ICON_PRESETS.find((p) => p.name === name)?.glyph ?? null;
}

// Drives readable text/tag styling over an image theme, from resolveTheme's
// single "#ffffff"/"#000000" textColor call. Centralized here rather than
// duplicated in NoteCard, the todo row, and the editor headers — every
// image-themed surface derives its light/dark text hierarchy from exactly
// the same opacity levels this way, one set of numbers instead of several
// slowly drifting copies. Returns a CSS custom-property declaration
// string; consumers apply it via their own inline `style` and reference
// the variables from their own CSS (see NoteCard.svelte's
// .has-image-theme rules for the reference usage).
export function getImageTextColorVars(textColor: string): string {
  const isLight = textColor !== "#000000";
  const rgb = isLight ? "255,255,255" : "0,0,0";
  return (
    `--theme-text-hi: rgba(${rgb},0.95); ` +
    `--theme-text-mid: rgba(${rgb},0.78); ` +
    `--theme-text-lo: rgba(${rgb},0.6); ` +
    `--theme-tag-bg: rgba(${rgb},${isLight ? "0.16" : "0.12"}); ` +
    `--theme-tag-text: rgba(${rgb},${isLight ? "0.92" : "0.85"});`
  );
}

// Plain #rrggbb -> rgba(...) with a given alpha. Used for the wash
// behind a themed card's text rather than painting the full preset
// color flat across the card — a full-strength preset color behind
// dark-on-light or light-on-dark text would fight readability, a light
// wash of it doesn't. Written by hand instead of relying on CSS
// color-mix() — Tauri on Android renders through the OS's system
// WebView, whose Chromium version trails what a desktop browser ships,
// so this stays on a plain rgba() string every WebView version supports.
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// What a card/editor should actually paint, resolved from a ThemeRef +
// the custom-theme registry. Kept as one small pure function so
// NoteCard, the todo list row, and the editor header can all resolve
// the exact same way instead of three slightly-different copies of this
// logic drifting apart.
//
// "image" always carries a textColor — either the real one computed at
// upload time (see CustomTheme.textColor's comment for why it can't be
// computed here instead), or "#ffffff" as a fallback for any custom
// theme uploaded before that field existed. That fallback deliberately
// matches what every image-themed surface already assumed unconditionally
// before this existed (NoteCard's old .has-image-theme always forced
// light text) — old uploads keep looking exactly as they already do;
// only new ones get an actually-earned answer instead of a guess.
export type ResolvedTheme = { kind: "none" } | { kind: "color"; color: string } | { kind: "image"; dataUrl: string; textColor: string };

export function resolveTheme(theme: ThemeRef | null | undefined, customThemes: CustomTheme[]): ResolvedTheme {
  if (!theme) return { kind: "none" };
  if (theme.kind === "custom") {
    const found = theme.customThemeId ? customThemes.find((c) => c.id === theme.customThemeId) : undefined;
    // Referenced custom theme was deleted out from under this entry —
    // fall back to no theme rather than throwing or showing a broken
    // image icon.
    return found ? { kind: "image", dataUrl: found.data, textColor: found.textColor ?? "#ffffff" } : { kind: "none" };
  }
  const color = getPresetColor(theme.name ?? "none");
  return color ? { kind: "color", color } : { kind: "none" };
}
