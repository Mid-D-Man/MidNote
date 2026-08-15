// App-wide display settings — currently just note font size. Scoped as a
// global preference (applies to every note's editing view), not per-note
// metadata: the DixScript entry schema (mdix_files/schema/entry-note.mdix)
// has no style field, and adding one is a bigger change than "add a font
// size picker" warrants right now. Revisit as per-note if that's wanted
// later.
const KEY = "midnote:font-size";
const DEFAULT_SIZE = 15;
const SIZES = [10, 12, 14, 15, 16, 18, 20, 24] as const;

function load(): number {
  if (typeof localStorage === "undefined") return DEFAULT_SIZE;
  const raw = localStorage.getItem(KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return SIZES.includes(n as (typeof SIZES)[number]) ? n : DEFAULT_SIZE;
}

export const fontSize = $state({ value: load() });

export function setFontSize(size: number) {
  fontSize.value = size;
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, String(size));
}

export const FONT_SIZES = SIZES;
