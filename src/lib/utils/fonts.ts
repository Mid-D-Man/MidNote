// Round 33 — custom fonts: the parts that need no browser.
//
// A font choice is stored in two places, and both use the SAME string, the
// CSS `font-family` value:
//   - inside a note, as the inline style Tiptap's FontFamily extension writes
//     on a span (`<span style="font-family: ...">`), so one word can differ
//     from the rest of the note;
//   - in settings, as the note's default font.
// Using the CSS value itself (not an id) means a saved note renders the same
// with no lookup, and a note whose font has since been deleted simply falls
// back to the next family in the list instead of breaking.
//
// An imported font is registered under its display name, so the value for it
// is `"Name", sans-serif`. The generic fallback after it is what a note shows
// while the file is still loading or after the font was removed.

export const FONT_FALLBACK = "sans-serif";

/** Largest font file accepted. A CJK font can be tens of MB — too much to keep and to parse on a phone. */
export const MAX_FONT_BYTES = 8 * 1024 * 1024;
/** Most fonts that can be imported. Keeps the picker usable and storage bounded. */
export const MAX_CUSTOM_FONTS = 24;
export const MAX_FONT_NAME_LENGTH = 40;

export type BuiltinFont = { id: string; label: string; family: string | null };

/**
 * `family: null` means "no override" — the note's default font shows through.
 * The other three are explicit, so a word can be set back to sans even when
 * the note's default font is mono.
 */
export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  { id: "default", label: "Default", family: null },
  { id: "sans", label: "Sans", family: 'Roboto, "Segoe UI", sans-serif' },
  { id: "serif", label: "Serif", family: "Georgia, serif" },
  { id: "mono", label: "Mono", family: "ui-monospace, Consolas, monospace" },
];

export type FontKind = "ttf" | "otf" | "woff" | "woff2";

/** Identify a font file from its first bytes. Extensions lie and Android pickers hide them; the header does not. */
export function detectFontKind(bytes: Uint8Array): FontKind | null {
  if (bytes.length < 4) return null;
  const [a, b, c, d] = bytes;
  if (a === 0x00 && b === 0x01 && c === 0x00 && d === 0x00) return "ttf";
  if (a === 0x74 && b === 0x72 && c === 0x75 && d === 0x65) return "ttf"; // "true" (old Apple TrueType)
  if (a === 0x4f && b === 0x54 && c === 0x54 && d === 0x4f) return "otf"; // "OTTO"
  if (a === 0x77 && b === 0x4f && c === 0x46 && d === 0x46) return "woff"; // "wOFF"
  if (a === 0x77 && b === 0x4f && c === 0x46 && d === 0x32) return "woff2"; // "wOF2"
  return null; // includes "ttcf" collections: one file, many faces — not supported
}

/** "My_Font-Regular.ttf" -> "My Font-Regular". Quotes/backslashes/control characters can't survive a CSS string. */
export function fontNameFromFile(fileName: string): string {
  let n = fileName.replace(/\.(ttf|otf|woff2?)$/i, "");
  n = n.replace(/[_]+/g, " ");
  n = n.replace(/["'\\;{}<>()\u0000-\u001f\u007f]/g, "");
  n = n.replace(/\s+/g, " ").trim();
  if (n.length > MAX_FONT_NAME_LENGTH) n = n.slice(0, MAX_FONT_NAME_LENGTH).trim();
  return n || "Custom font";
}

/** A name not already used (case-insensitive) — "Lora", then "Lora 2", "Lora 3"... */
export function uniqueFontName(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; i < 1000; i++) {
    const suffix = ` ${i}`;
    const candidate = `${name.slice(0, MAX_FONT_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${name}-${Date.now()}`;
}

/** The CSS family value for an imported font. */
export function customFontFamily(name: string): string {
  return `"${name}", ${FONT_FALLBACK}`;
}

/**
 * First family in a CSS font-family list, unquoted, lowercased — the key used
 * to tell which entry of the picker a stored value corresponds to. Tolerates
 * the quote styles the browser normalises to when it round-trips a style.
 */
export function primaryFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^\s*(?:"([^"]*)"|'([^']*)'|([^,]+))/);
  const first = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return first ? first.toLowerCase() : null;
}

export type FontOption = { key: string; label: string; family: string | null; custom: boolean };

/** Everything the toolbar picker and the default-font chooser list, built-ins first. */
export function fontOptions(customNames: readonly string[]): FontOption[] {
  return [
    ...BUILTIN_FONTS.map((f) => ({ key: f.id, label: f.label, family: f.family, custom: false })),
    ...customNames.map((n) => ({ key: `custom:${n}`, label: n, family: customFontFamily(n), custom: true })),
  ];
}

/** Which option a stored family value is. A value naming a font that no longer exists matches nothing (-> null). */
export function matchOption(options: readonly FontOption[], value: string | null | undefined): FontOption | null {
  const p = primaryFamily(value);
  if (p === null) return options.find((o) => o.family === null) ?? null;
  return options.find((o) => o.family !== null && primaryFamily(o.family) === p) ?? null;
}

/** A stored default-note-font value is only kept if it is something we could have written. */
export function sanitizeFamilyValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 200) return null;
  if (/[;{}<>\u0000-\u001f]/.test(v)) return null;
  return v;
}
