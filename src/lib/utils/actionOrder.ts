// The order of the rows in the Actions sheet of a note, a todo and a board, and the user's own order for them (Settings -> Actions).
// Pure TypeScript: the sheets ask orderFor() which of their rows to show and in what order.
//
// The default order is the one the user asked for. A todo or a board has fewer actions than a note (no pages, no Ask AI, no find
// and replace ...): it shows the same order with the ones it doesn't have left out. A saved order that is old (an action added
// since) or damaged (an unknown name, a repeat) still works: unknown and repeated names are dropped, and an action the saved
// order doesn't know about goes after the action that comes before it in the default order.

export type ActionId =
  | "pin"
  | "reading"
  | "readAloud"
  | "copy"
  | "duplicate"
  | "pages"
  | "askAi"
  | "find"
  | "select"
  | "theme"
  | "share"
  | "export"
  | "download"
  | "reminder"
  | "comments"
  | "wordCount";

/** Top to bottom, as asked for: Word count last. */
export const DEFAULT_ACTION_ORDER: readonly ActionId[] = [
  "pin",
  "reading",
  "readAloud",
  "copy",
  "duplicate",
  "pages",
  "askAi",
  "find",
  "select",
  "theme",
  "share",
  "export",
  "download",
  "reminder",
  "comments",
  "wordCount",
];

export const ACTION_LABELS: Readonly<Record<ActionId, string>> = {
  pin: "Pin to top",
  reading: "Reading view",
  readAloud: "Read aloud",
  copy: "Copy contents",
  duplicate: "Duplicate",
  pages: "Pages",
  askAi: "Ask AI",
  find: "Find & replace",
  select: "Select text",
  theme: "Theme",
  share: "Share",
  export: "Export as",
  download: "Download as text",
  reminder: "Reminder",
  comments: "Comments",
  wordCount: "Word count",
};

/** Which actions each kind of entry has. */
export const NOTE_ACTIONS: readonly ActionId[] = ["pin", "reading", "readAloud", "copy", "duplicate", "pages", "askAi", "find", "select", "theme", "share", "export", "reminder", "comments", "wordCount"];
export const TODO_ACTIONS: readonly ActionId[] = ["pin", "readAloud", "copy", "duplicate", "theme", "share", "export", "download", "reminder"];
export const BOARD_ACTIONS: readonly ActionId[] = ["pin", "readAloud", "copy", "duplicate", "theme", "share", "export", "reminder"];

const KNOWN = new Set<string>(DEFAULT_ACTION_ORDER);

/** A saved value (anything) made into a complete, valid order: known names once each, in the saved order; missing ones put back. */
export function normalizeOrder(saved: unknown): ActionId[] {
  const out: ActionId[] = [];
  const seen = new Set<string>();
  if (Array.isArray(saved)) {
    for (const v of saved) {
      if (typeof v === "string" && KNOWN.has(v) && !seen.has(v)) {
        seen.add(v);
        out.push(v as ActionId);
      }
    }
  }
  // an action the saved order doesn't have goes right after the one before it in the default order (or first, when nothing before it is there)
  DEFAULT_ACTION_ORDER.forEach((id, i) => {
    if (seen.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(DEFAULT_ACTION_ORDER[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    seen.add(id);
  });
  return out;
}

/** The rows one sheet shows, in the user's order. */
export function orderFor(available: readonly ActionId[], saved: unknown): ActionId[] {
  const have = new Set<ActionId>(available);
  return normalizeOrder(saved).filter((id) => have.has(id));
}

/** The order with `id` moved up (delta -1) or down (+1) by one place; the same order when it can't move. */
export function moveAction(order: readonly ActionId[], id: ActionId, delta: -1 | 1): ActionId[] {
  const from = order.indexOf(id);
  const to = from + delta;
  const next = order.slice();
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Is this the default order? (Then nothing needs to be saved.) */
export function isDefaultOrder(order: readonly ActionId[]): boolean {
  return order.length === DEFAULT_ACTION_ORDER.length && order.every((id, i) => id === DEFAULT_ACTION_ORDER[i]);
}
