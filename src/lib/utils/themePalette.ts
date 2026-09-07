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
export type ResolvedTheme = { kind: "none" } | { kind: "color"; color: string } | { kind: "image"; dataUrl: string };

export function resolveTheme(theme: ThemeRef | null | undefined, customThemes: CustomTheme[]): ResolvedTheme {
  if (!theme) return { kind: "none" };
  if (theme.kind === "custom") {
    const found = theme.customThemeId ? customThemes.find((c) => c.id === theme.customThemeId) : undefined;
    // Referenced custom theme was deleted out from under this entry —
    // fall back to no theme rather than throwing or showing a broken
    // image icon.
    return found ? { kind: "image", dataUrl: found.data } : { kind: "none" };
  }
  const color = getPresetColor(theme.name ?? "none");
  return color ? { kind: "color", color } : { kind: "none" };
}
