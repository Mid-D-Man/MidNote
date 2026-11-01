// Turns the AI's answer for "Create with AI" on the Todos and Boards tabs into data the app can file.
//
// The AI is asked for a plain LINE format, not JSON, on purpose: a small model breaks JSON easily (one stray quote or
// trailing comma and nothing parses) and an answer that is cut off by the output limit is then worthless, while with
// lines every complete line still counts and a cut-off last line is simply dropped. The server owns the wording of the
// request (workers/midnote-ai/src/prompts.ts); this file is the other half: tolerant reading, hard limits, no trust.
//
//   Todo                                   Board
//   TITLE: Plan a camping weekend          TITLE: Story arc
//   ## Before you go                       NODE a: Opening scene :: The hero wakes up
//   - Book the campsite :: Check times     NODE b: The call to adventure
//   - Pack the tent                        LINK a -> b
//
// Everything the AI wrote is DATA: it is cut to length, counted and de-duplicated here, and nothing in it is ever run
// or treated as markup. Plain TypeScript, no Svelte.

export const AI_TODO_LIMITS = { categories: 8, steps: 40, title: 80, category: 40, step: 120, detail: 300 } as const;
export const AI_BOARD_LIMITS = { nodes: 30, links: 60, title: 80, label: 60, body: 300 } as const;

export const DEFAULT_CATEGORY = "Steps";

export interface ParsedTodo {
  title: string;
  categories: string[];
  steps: { category: string; title: string; content: string }[];
  /** Lines that were understood but left out because of the limits above. */
  dropped: number;
}

export interface ParsedBoard {
  title: string;
  nodes: { key: string; label: string; body: string }[];
  links: { from: string; to: string }[];
  /** Nodes, links or lines that were left out (over a limit, a link to a node that isn't there, a repeat). */
  dropped: number;
}

/** The answer's lines, trimmed. (A code fence, a lead-in sentence or a closing remark are just lines that match nothing.) */
function linesOf(raw: string): string[] {
  return raw.split(/\r\n?|\n/).map((l) => l.trim());
}

function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

// Takes off bold (two stars or two underscores) and `code` marks around text: the app stores plain text here.
function plainText(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** "title :: detail" -> [title, detail]. */
function splitDetail(s: string): [string, string] {
  const i = s.indexOf("::");
  if (i < 0) return [s.trim(), ""];
  return [s.slice(0, i).trim(), s.slice(i + 2).trim()];
}

const TITLE_RE = /^title\s*[:：]\s*(.*)$/i;

function titleOf(line: string): string | null {
  const m = TITLE_RE.exec(line);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------- todos

const STEP_MARK = /^(?:[-*•–]|\d{1,3}[.)])\s+(?:\[[ xX]?\]\s*)?(.*)$/;
const CATEGORY_MARK = /^#{2,3}\s+(.*)$/;
const CATEGORY_WORD = /^category\s*[:：]\s*(.*)$/i;

/**
 * Reads a todo. Returns null when there is nothing usable (not a single step), so the caller can say so instead of
 * filing an empty todo. The title is "" when the AI gave none (the caller picks one).
 */
export function parseAiTodo(raw: string): ParsedTodo | null {
  const L = AI_TODO_LIMITS;
  let title = "";
  const order: string[] = [];
  const known = new Map<string, string>(); // lower-case name -> the name as first written
  const steps: ParsedTodo["steps"] = [];
  let dropped = 0;
  let current: string | null = null;

  const useCategory = (name: string): string | null => {
    const clean = cut(plainText(name), L.category);
    if (!clean) return current;
    const key = clean.toLowerCase();
    const have = known.get(key);
    if (have) return have;
    if (order.length >= L.categories) {
      dropped++;
      return null;
    }
    known.set(key, clean);
    order.push(clean);
    return clean;
  };

  for (const line of linesOf(raw)) {
    const t = titleOf(line);
    if (t !== null) {
      if (!title) title = cut(plainText(t), L.title);
      continue;
    }
    const c = CATEGORY_MARK.exec(line) ?? CATEGORY_WORD.exec(line);
    if (c) {
      current = useCategory(c[1]);
      continue;
    }
    const s = STEP_MARK.exec(line);
    if (!s) continue; // anything else (a preamble, a remark) is ignored
    const [rawTitle, rawDetail] = splitDetail(plainText(s[1]));
    const stepTitle = cut(rawTitle, L.step);
    if (!stepTitle) continue;
    if (steps.length >= L.steps) {
      dropped++;
      continue;
    }
    // steps before any heading go in the default category; a step under a heading that was over the limit is dropped
    if (current === null && order.length === 0) current = useCategory(DEFAULT_CATEGORY);
    const cat = current;
    if (cat === null) {
      dropped++;
      continue;
    }
    steps.push({ category: cat, title: stepTitle, content: cut(rawDetail, L.detail) });
  }

  if (steps.length === 0) return null;
  // a heading with nothing under it is not worth a tab
  const used = order.filter((c) => steps.some((s) => s.category === c));
  return { title, categories: used, steps, dropped };
}

// ---------------------------------------------------------------- boards

const NODE_RE = /^node\s+([A-Za-z0-9_-]{1,12})\s*[:：.)-]\s*(.*)$/i;
const LINK_RE = /^link\s+(.*)$/i;
const ARROW = /\s*(?:-+>|=+>|→|➔|⟶)\s*/;

/**
 * Reads a board. Returns null when there is not a single node. Links to a node that doesn't exist, links from a node to
 * itself and repeated links are left out; nodes keep the order they were written in.
 */
export function parseAiBoard(raw: string): ParsedBoard | null {
  const L = AI_BOARD_LIMITS;
  let title = "";
  const nodes: ParsedBoard["nodes"] = [];
  const seen = new Set<string>();
  const linkLines: string[] = [];
  let dropped = 0;

  for (const line of linesOf(raw)) {
    const t = titleOf(line);
    if (t !== null) {
      if (!title) title = cut(plainText(t), L.title);
      continue;
    }
    const n = NODE_RE.exec(line);
    if (n) {
      const key = n[1].toLowerCase();
      const [rawLabel, rawBody] = splitDetail(plainText(n[2]));
      const label = cut(rawLabel, L.label);
      if (!label) continue;
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      if (nodes.length >= L.nodes) {
        dropped++;
        continue;
      }
      seen.add(key);
      nodes.push({ key, label, body: cut(rawBody, L.body) });
      continue;
    }
    const l = LINK_RE.exec(line);
    if (l) linkLines.push(l[1]);
  }

  if (nodes.length === 0) return null;

  const links: ParsedBoard["links"] = [];
  const pairs = new Set<string>();
  for (const text of linkLines) {
    // "a -> b -> c" is two links; a chain with a cut-off end ("a ->") just has fewer
    const keys = text
      .split(ARROW)
      .map((k) => k.trim().toLowerCase().replace(/[.,;]+$/, ""))
      .filter((k) => k.length > 0);
    for (let i = 0; i + 1 < keys.length; i++) {
      const from = keys[i];
      const to = keys[i + 1];
      if (!seen.has(from) || !seen.has(to) || from === to) {
        dropped++;
        continue;
      }
      const id = `${from}>${to}`;
      if (pairs.has(id)) {
        dropped++;
        continue;
      }
      if (links.length >= L.links) {
        dropped++;
        continue;
      }
      pairs.add(id);
      links.push({ from, to });
    }
  }
  return { title, nodes, links, dropped };
}

/** A title for a draft that came without one: the start of what was asked for. */
export function fallbackTitle(prompt: string, max = 60): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}
