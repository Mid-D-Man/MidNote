// Comments on an entry (round 30): private, timestamped remarks attached to
// a whole note, todo or board — the Notion "comment under the page title"
// idea, minus the collaboration (MidNote has no accounts, so every comment
// is simply yours).
//
// This file is the pure logic only — no Svelte, no storage — so the rules
// (what counts as a valid comment, how times read) can be tested on their
// own; CommentsSheet.svelte is the UI on top and headers persist through
// saveEntry() like every other Actions-sheet change.
//
// Comments are deliberately NOT part of exports (see export/blocks.ts) and,
// crucially, they travel inside the encrypted payload when an entry is
// locked (lockFlow.ts) — a locked note must not leave its remarks readable
// on disk.

import type { EntryComment } from "$lib/types/entry";

export const MAX_COMMENT_LENGTH = 2000;

/**
 * Coerce whatever was stored into a clean list. Drops anything that isn't
 * a comment with real text, repairs a missing/duplicate id, and keeps
 * order. Used when entries are loaded, so older entries (no field) and any
 * hand-edited file both come out well-formed.
 */
export function sanitizeComments(raw: unknown, makeId: () => string): EntryComment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EntryComment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.text !== "string" || !rec.text.trim()) continue;
    let id = typeof rec.id === "string" && rec.id ? rec.id : makeId();
    if (seen.has(id)) id = makeId();
    seen.add(id);
    out.push({
      id,
      text: rec.text,
      createdAt: typeof rec.createdAt === "string" ? rec.createdAt : "",
    });
  }
  return out;
}

/** A new comment from typed text, or null when there's nothing to post. */
export function makeComment(text: string, id: string, now: Date = new Date()): EntryComment | null {
  const trimmed = text.replace(/\s+$/g, "").replace(/^\s*\n/, "");
  if (!trimmed.trim()) return null;
  return { id, text: trimmed.slice(0, MAX_COMMENT_LENGTH), createdAt: now.toISOString() };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * "Just now", "5 min ago", "Today, 14:05", "Yesterday, 14:05", or
 * "29 Sep 2026, 14:05". Local time, 24-hour, written by hand rather than
 * through Intl so it reads the same on every WebView.
 */
export function formatCommentTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const diffMs = now.getTime() - d.getTime();
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diffMs < 0) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock}`; // clock skew
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (sameDay(d, now)) return `Today, ${clock}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday, ${clock}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock}`;
}

/** Oldest first, stable for equal/missing timestamps. */
export function sortByTime(comments: readonly EntryComment[]): EntryComment[] {
  return comments
    .map((c, i) => ({ c, i, t: Date.parse(c.createdAt) || 0 }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.c);
}
