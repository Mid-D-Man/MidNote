// Pure helpers for typing and finding tag names (the Tags popup on the landing pages, Settings -> Tags). No Svelte.

export const MAX_TAG_LENGTH = 40;

/** A tag name as typed: runs of whitespace collapsed to one space, trimmed. "" when nothing is left or it is too long. */
export function cleanTagName(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length === 0 || t.length > MAX_TAG_LENGTH ? "" : t;
}

/** The tags still to offer: not already on the item, and containing what was typed (case does not matter). Order is kept. */
export function visibleTags(available: readonly string[], selected: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of available) {
    if (seen.has(t) || selected.includes(t)) continue;
    seen.add(t);
    if (q === "" || t.toLowerCase().includes(q)) out.push(t);
  }
  return out;
}

/** What "Create" would make from `query`: the cleaned name, or "" when there is nothing to create (empty, too long, or a tag
 *  with that name — in any capitalisation — is already in the list or on the item). */
export function creatableName(query: string, available: readonly string[], selected: readonly string[]): string {
  const name = cleanTagName(query);
  if (!name) return "";
  const lower = name.toLowerCase();
  if (available.some((t) => t.toLowerCase() === lower) || selected.some((t) => t.toLowerCase() === lower)) return "";
  return name;
}
