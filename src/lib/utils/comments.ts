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

// Round 39 — comments belong to a PAGE of a note, not to the whole note. A note's
// first page is not a NotePage object (it lives in note.content — see entry.ts),
// so it has no id of its own; this constant stands in for it. Every other page is
// keyed by its NotePage.id.
export const FIRST_PAGE = "page-1";

/** The page key for position `index` in the note's page strip (0 = the first page). */
export function pageKeyAt(pages: readonly { id: string }[], index: number): string {
  if (index <= 0) return FIRST_PAGE;
  return pages[index - 1]?.id ?? FIRST_PAGE;
}

/** What the page is called in the UI: its own name, else its position ("Page 2"). */
export function pageLabelAt(page1Name: string | null, pages: readonly { name: string | null }[], index: number): string {
  const name = index <= 0 ? page1Name : pages[index - 1]?.name;
  return name && name.trim() ? name.trim() : `Page ${Math.max(0, index) + 1}`;
}

/** The comments written on one page, in stored order. */
export function commentsForPage(comments: readonly EntryComment[], pageId: string): EntryComment[] {
  return comments.filter((c) => c.pageId === pageId);
}

/** All comments except those on `pageId` — what remains when that page is deleted. */
export function dropPageComments(comments: readonly EntryComment[], pageId: string): EntryComment[] {
  return comments.filter((c) => c.pageId !== pageId);
}

/** Move every comment on page `from` over to page `to` (a promoted page taking over as page 1). */
export function remapPageComments(comments: readonly EntryComment[], from: string, to: string): EntryComment[] {
  return comments.map((c) => (c.pageId === from ? { ...c, pageId: to } : c));
}

/**
 * The comment list after the page at strip position `index` is deleted. That
 * page's comments go with it. Deleting the FIRST page promotes the next page into
 * its place (note.ts: page 1 is not an object, so the promoted page's content
 * moves into note.content and its id disappears) — the promoted page's comments
 * therefore follow it and become page-1 comments.
 */
export function commentsAfterPageDelete(
  comments: readonly EntryComment[],
  pages: readonly { id: string }[],
  index: number,
): EntryComment[] {
  if (index <= 0) {
    const promoted = pages[0];
    const rest = dropPageComments(comments, FIRST_PAGE);
    return promoted ? remapPageComments(rest, promoted.id, FIRST_PAGE) : rest;
  }
  const page = pages[index - 1];
  return page ? dropPageComments(comments, page.id) : [...comments];
}

/**
 * Comments that point at a page that no longer exists (a hand-edited file, an
 * interrupted page delete) would be invisible forever. They are filed under the
 * first page instead, so nothing the user wrote is lost.
 */
export function reconcileCommentPages(comments: readonly EntryComment[], validPageIds: Iterable<string>): EntryComment[] {
  const ok = new Set(validPageIds);
  ok.add(FIRST_PAGE);
  return comments.map((c) => (ok.has(c.pageId) ? c : { ...c, pageId: FIRST_PAGE }));
}

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
      // Round 39: older comments have no page; they were written on the whole note, so page 1.
      pageId: typeof rec.pageId === "string" && rec.pageId && rec.pageId.length <= 100 ? rec.pageId : FIRST_PAGE,
    });
  }
  return out;
}

/** A new comment from typed text, or null when there's nothing to post. */
export function makeComment(text: string, id: string, pageId: string = FIRST_PAGE, now: Date = new Date()): EntryComment | null {
  const trimmed = text.replace(/\s+$/g, "").replace(/^\s*\n/, "");
  if (!trimmed.trim()) return null;
  return { id, text: trimmed.slice(0, MAX_COMMENT_LENGTH), createdAt: now.toISOString(), pageId };
}

/**
 * `comments` with the text of comment `id` replaced — id and createdAt are
 * kept, so it keeps its place in the list and its original time. Returns null
 * (changing nothing) when the comment is gone or the new text is empty;
 * "empty" must not silently delete a comment, that is what Delete is for.
 */
export function editComment(comments: readonly EntryComment[], id: string, text: string): EntryComment[] | null {
  const index = comments.findIndex((c) => c.id === id);
  if (index === -1) return null;
  const trimmed = text.replace(/\s+$/g, "").replace(/^\s*\n/, "");
  if (!trimmed.trim()) return null;
  const next = comments.map((c) => ({ ...c }));
  next[index].text = trimmed.slice(0, MAX_COMMENT_LENGTH);
  return next;
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
