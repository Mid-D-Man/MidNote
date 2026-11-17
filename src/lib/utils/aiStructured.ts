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
// A small model does not always follow a format to the letter, so this reads what it can (see the notes on each parser)
// and fills the gaps it can fill honestly: a board whose boxes the AI forgot to connect gets them joined in the order
// they were written (ParsedBoard.joined says how many arrows are the app's own). It never invents text: a step the AI
// gave no description stays without one, and the creator says so.
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
  /** How many of `links` the app added itself because the AI left boxes unconnected (all of them when it wrote none). */
  joined: number;
}

/** The answer's lines, trimmed. (A code fence, a lead-in sentence or a closing remark are just lines that match nothing.) */
function linesOf(raw: string): string[] {
  return raw.split(/\r\n?|\n/).map((l) => l.trim());
}

/** The answer's lines with how far each is indented (a nested bullet under a step is that step's description). */
function indentedLines(raw: string): { text: string; indent: number }[] {
  return raw.split(/\r\n?|\n/).map((l) => {
    const t = l.replace(/\t/g, "    ");
    return { text: t.trim(), indent: t.length - t.trimStart().length };
  });
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
    .trim()
    .replace(/^(?:\*\*|__|`)+|(?:\*\*|__|`)+$/g, "") // a mark with no partner (the other half was on the keyword)
    .trim();
}

/**
 * A line with the dressing a chat model likes to add taken off the front: a quote mark, a list bullet or number, and
 * bold / code marks. "- **NODE a:** Label" then reads like "NODE a: Label". Used for board lines, where the keyword must
 * be the first thing on the line.
 */
function bare(line: string): string {
  return line
    .replace(/^[>\s]+/, "")
    .replace(/^(?:[-*•–]\s+|\d{1,3}[.)]\s+)/, "")
    .replace(/^(?:\*\*|__|\*|`)+/, "")
    .trim();
}

/** A few lines of what the AI actually wrote, for a message when nothing in it could be used (and for the debug log). */
export function answerExcerpt(raw: string, maxLines = 8, maxChars = 600): string {
  const lines = raw.split(/\r\n?|\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const text = lines.slice(0, maxLines).map((l) => (l.length > 160 ? l.slice(0, 159) + "…" : l)).join("\n");
  const more = lines.length > maxLines || text.length > maxChars;
  return (text.length > maxChars ? text.slice(0, maxChars - 1) : text) + (more ? "\n…" : "");
}

/** "title :: detail" -> [title, detail]. */
function splitDetail(s: string): [string, string] {
  const i = s.indexOf("::");
  if (i < 0) return [s.trim(), ""];
  return [s.slice(0, i).trim(), s.slice(i + 2).trim()];
}

const TITLE_RE = /^title\s*[:：]\s*(.*)$/i;

/** "Category: Water" / "Category 2 - Water" -> "Water" (the model sometimes repeats the word on a ## heading). A name that is only the word stays. */
export function withoutCategoryWord(name: string): string {
  return name.replace(/^(?:sub-?\s*)?category\s*\d*\s*[:：\-–—]\s*(?=\S)/i, "").trim();
}

function titleOf(line: string): string | null {
  const m = TITLE_RE.exec(line);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------- todos

const STEP_MARK = /^(?:[-*•–]|\d{1,3}[.)])\s+(?:\[[ xX]?\]\s*)?(.*)$/;
const CATEGORY_MARK = /^#{2,3}\s+(.*)$/;
const CATEGORY_WORD = /^category\s*[:：]\s*(.*)$/i;
// a line that is only bold text, "**Before you go**" or "**Before you go:**", is a heading
const CATEGORY_BOLD = /^(?:\*\*|__)([^*_]{1,60}?)\s*[:：]?\s*(?:\*\*|__)\s*[:：]?$/;
// "Description: ..." on the line after a step
const DETAIL_LABEL = /^(?:description|details?|notes?|why|how|tip)\s*[:：]\s*(.+)$/i;
// "**Title**: detail" / "**Title:** detail" / "**Title** - detail" (the separator inside or after the bold)
const BOLD_STEP = /^(?:\*\*|__)([^*_]+?)\s*([:：–—-]?)\s*(?:\*\*|__)\s*([:：–—-]?)\s*(.+)$/;

/**
 * A step line's text -> [step, description]. The asked-for form is "Step :: description"; a model also writes "**Step**:
 * description", "Step - description" (a spaced dash) and "Step: description" (at most 8 words before the colon, and the
 * colon must be followed by a space, so "10:30" and "http://..." are safe).
 */
function splitStep(text: string): [string, string] {
  if (text.includes("::")) return splitDetail(plainText(text));
  const b = BOLD_STEP.exec(text);
  if (b && (b[2] || b[3])) return [plainText(b[1]), plainText(b[4])];
  const plain = plainText(text);
  const dash = /^(.{2,}?)\s+[–—-]\s+(.+)$/.exec(plain);
  if (dash) return [dash[1].trim(), dash[2].trim()];
  const colon = /^([^:：]+?)\s*[:：]\s+(.+)$/.exec(plain);
  if (colon && colon[1].trim().split(/\s+/).length <= 8) return [colon[1].trim(), colon[2].trim()];
  return [plain, ""];
}

/** "TITLE: x" with the dressing a chat model adds in front of it ("# TITLE:", "**TITLE:** x") taken off. */
function titleLine(line: string): string | null {
  return titleOf(line.replace(/^[>#\s]+/, "").replace(/^(?:\*\*|__|\*|`)+/, ""));
}

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
    const clean = cut(withoutCategoryWord(plainText(name)), L.category);
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

  let last: ParsedTodo["steps"][number] | null = null; // the step the next nested line / "Description:" line belongs to
  let stepIndent = 0;
  let afterStep = false; // the previous line was a step (or its description), with no blank line between
  const addDetail = (step: ParsedTodo["steps"][number], text: string) => {
    const more = plainText(text);
    if (more) step.content = cut(step.content ? `${step.content} ${more}` : more, L.detail);
  };

  for (const { text: line, indent } of indentedLines(raw)) {
    if (!line) {
      afterStep = false;
      continue;
    }
    const t = titleLine(line);
    if (t !== null) {
      if (!title) title = cut(plainText(t), L.title);
      afterStep = false;
      continue;
    }
    const c = CATEGORY_MARK.exec(line) ?? CATEGORY_WORD.exec(line) ?? CATEGORY_BOLD.exec(line);
    if (c) {
      current = useCategory(c[1]);
      last = null;
      afterStep = false;
      continue;
    }
    const s = STEP_MARK.exec(line);
    const nested = afterStep && last !== null && indent > stepIndent;
    if (s && !nested) {
      const [rawTitle, rawDetail] = splitStep(s[1]);
      const stepTitle = cut(rawTitle, L.step);
      if (!stepTitle) continue;
      if (steps.length >= L.steps) {
        dropped++;
        last = null;
        afterStep = false;
        continue;
      }
      // steps before any heading go in the default category; a step under a heading that was over the limit is dropped
      if (current === null && order.length === 0) current = useCategory(DEFAULT_CATEGORY);
      const cat = current;
      if (cat === null) {
        dropped++;
        last = null;
        afterStep = false;
        continue;
      }
      const step = { category: cat, title: stepTitle, content: cut(rawDetail, L.detail) };
      steps.push(step);
      last = step;
      stepIndent = indent;
      afterStep = true;
      continue;
    }
    // a description on the line(s) under a step: a nested bullet, an indented line, or "Description: ..."
    if (afterStep && last) {
      const body = s ? s[1] : (DETAIL_LABEL.exec(line)?.[1] ?? (indent > stepIndent ? line : null));
      if (body !== null) {
        addDetail(last, body);
        continue;
      }
    }
    afterStep = false; // anything else (a preamble, a remark) is ignored
  }

  if (steps.length === 0) return null;
  // a heading with nothing under it is not worth a tab
  const used = order.filter((c) => steps.some((s) => s.category === c));
  return { title, categories: used, steps, dropped };
}

// ---------------------------------------------------------------- boards

// "NODE a: Label :: detail". Tolerated: a bullet / bold / code mark in front (see bare), "NODE: a - Label", "NODE [a]: Label",
// "NODE a = Label", "NODE 1. Label". The key is 1-12 letters, digits, _ or -.
const NODE_RE = /^node\b\s*[:：]?\s*[[(]?([A-Za-z0-9_-]{1,12})[\])]?\s*(?:\*\*|__)?\s*[:：.)=–—-](?![:：])\s*(.*)$/i;
// "NODE: Opening scene :: detail" - a NODE line the AI wrote without a key; the app makes one up (n1, n2, ...) and a link can
// still name the node by its label.
const NODE_KEYLESS_RE = /^node\s*[:：]\s*(.+)$/i;
// "LINK a -> b" (also "LINKS", "EDGE", "CONNECTION"; a colon after the word is fine)
const LINK_RE = /^(?:link|edge|connect(?:ion)?)s?\b\s*[:：]?\s*(.*)$/i;
const ARROW = /\s*(?:-+>|=+>|→|➔|⟶|⇒)\s*/;
// several names in one place of a link line
const FAN = /\s*(?:,|;|&|\+|\band\b)\s*/i;
// between two names on a LINK line that has no arrow: "a to b", "a - b", "a, b"
const WORD_SEP = /\s+(?:to|with)\s+|\s+[-–—]\s+|\s*,\s*/i;

/** A node key as the AI may have written it in a link: "[A]", "(a)", "`a`", "a." -> "a". */
function normKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replace(/^[[("'`*_]+|[\])"'`*_.,;:]+$/g, "")
    .trim();
}

/**
 * Reads a board. Returns null when there is not a single node. Links to a node that doesn't exist, links from a node to
 * itself and repeated links are left out; nodes keep the order they were written in.
 *
 * A small model does not always follow the line format to the letter, so this reads what it can: lines dressed up as list
 * items or bold text, links that name a node by its label instead of its key, and a bare "a -> b" line. If the answer has
 * no NODE lines at all, it falls back to reading a list (one node per bullet) or arrows between labels ("Idea -> Plan").
 */
export function parseAiBoard(raw: string): ParsedBoard | null {
  const L = AI_BOARD_LIMITS;
  let title = "";
  const nodes: ParsedBoard["nodes"] = [];
  const seen = new Set<string>();
  const byLabel = new Map<string, string>(); // lower-case label -> key (a link may name a node by its label)
  const linkLines: { text: string; loose: boolean }[] = [];
  let dropped = 0;

  for (const line of linesOf(raw)) {
    const core = bare(line);
    const t = titleOf(core);
    if (t !== null) {
      if (!title) title = cut(plainText(t), L.title);
      continue;
    }
    const n = NODE_RE.exec(core);
    const keyless = n ? null : NODE_KEYLESS_RE.exec(core);
    if (n || keyless) {
      let key: string;
      let text: string;
      if (n) {
        key = n[1].toLowerCase();
        text = n[2];
      } else {
        let at = nodes.length + 1;
        while (seen.has(`n${at}`)) at++;
        key = `n${at}`;
        text = (keyless as RegExpExecArray)[1];
      }
      const [rawLabel, rawBody] = splitDetail(plainText(text));
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
      if (!byLabel.has(label.toLowerCase())) byLabel.set(label.toLowerCase(), key);
      nodes.push({ key, label, body: cut(rawBody, L.body) });
      continue;
    }
    const l = LINK_RE.exec(core);
    if (l) linkLines.push({ text: l[1], loose: false });
    else if (ARROW.test(core)) linkLines.push({ text: core, loose: true }); // "a -> b" with no LINK in front
  }

  if (nodes.length === 0) return boardFromLabels(raw);

  // A token in a link line -> a node key. Tried in this order: the key itself ("a", "[a]", "node a"), the label ("Opening
  // scene"), the position ("2" = the second node), and a label's beginning when only one label starts that way. The text
  // after a ":" / "(" / "|" / " - " is a note about the link, not part of the name.
  const resolve = (token: string): string | null => {
    for (const part of [token, token.split(/\s*[:(|]\s*|\s+-\s+/)[0]]) {
      const name = normKey(part).replace(/^nodes?\s+/i, "").trim();
      if (!name) continue;
      if (seen.has(name)) return name;
      const byName = byLabel.get(cut(plainText(name), L.label).toLowerCase());
      if (byName) return byName;
      if (/^\d{1,3}$/.test(name)) {
        const at = Number(name);
        if (at >= 1 && at <= nodes.length) return nodes[at - 1].key;
      }
      if (name.length >= 3) {
        const starts = nodes.filter((n) => n.label.toLowerCase().startsWith(name));
        if (starts.length === 1) return starts[0].key;
      }
    }
    return null;
  };

  // "a, b" / "a and b" / "a & b": several names in one place of a link ("LINK a -> b, c" is two arrows). A whole part that is
  // itself a name ("Rise, then fall") is kept whole.
  const names = (part: string): string[] => (resolve(part) ? [part] : part.split(FAN).map((k) => k.trim()).filter((k) => k.length > 0));

  // The places of a link line, in order: [[from...], [to...], ...]. Arrows are the usual separator; on a LINK line "a to b",
  // "a - b" and "a, b" are read as one arrow too. A bare arrow line outside LINK must have arrows to count.
  const places = (text: string, loose: boolean): string[][] | null => {
    const byArrow = text.split(ARROW).map((k) => k.trim()).filter((k) => k.length > 0);
    if (byArrow.length >= 2) return byArrow.map(names);
    if (loose) return null;
    const two = text.split(WORD_SEP).map((k) => k.trim()).filter((k) => k.length > 0);
    return two.length === 2 ? two.map((k) => [k]) : null;
  };

  const links: ParsedBoard["links"] = [];
  const pairs = new Set<string>();
  for (const { text: lineText, loose } of linkLines) {
    // "LINK a -> b, a -> c" / "a -> b; b -> c": several whole arrows on one line are read one by one
    for (const text of linkSegments(lineText)) {
      const cols = places(text, loose);
      if (!cols) {
        if (!loose && text.trim()) dropped++; // a LINK line with nothing readable in it
        continue;
      }
      // "a -> b -> c" is two arrows; a chain with a cut-off end ("a ->") just has fewer
      for (let c = 0; c + 1 < cols.length; c++) {
        for (const f of cols[c]) {
          for (const t of cols[c + 1]) {
            const from = resolve(f);
            const to = resolve(t);
            if (from === null || to === null || from === to) {
              if (!loose) dropped++; // an arrow in ordinary prose is not a link that went wrong
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
      }
    }
  }
  const joined = joinLoose(nodes, links, pairs);
  return { title, nodes, links, dropped, joined };
}

/** "a -> b, a -> c" is two links on one line (every part has its own arrow); "a -> b, c" is one arrow to two boxes (see FAN). */
function linkSegments(text: string): string[] {
  if (!/[;,]/.test(text)) return [text];
  const parts = text.split(/\s*[;,]\s*/).map((p) => p.trim()).filter((p) => p.length > 0);
  return parts.length > 1 && parts.every((p) => ARROW.test(p)) ? parts : [text];
}

/**
 * Boxes nobody pointed an arrow at or from are joined to the box written before them (the first one to the box after it),
 * and a board with no arrows at all becomes one chain in the order it was written: "link every node" is the rule the
 * AI was given, and a board of loose boxes is worth less than one the AI only half connected. Returns how many arrows were
 * added (they count towards the same limit as the AI's own).
 */
function joinLoose(nodes: { key: string }[], links: { from: string; to: string }[], pairs: Set<string>): number {
  if (nodes.length < 2) return 0;
  const touched = new Set<string>();
  for (const l of links) {
    touched.add(l.from);
    touched.add(l.to);
  }
  let added = 0;
  const add = (from: string, to: string) => {
    const id = `${from}>${to}`;
    if (links.length >= AI_BOARD_LIMITS.links || pairs.has(id)) return;
    pairs.add(id);
    links.push({ from, to });
    touched.add(from);
    touched.add(to);
    added++;
  };
  for (let i = 0; i < nodes.length; i++) {
    if (touched.has(nodes[i].key)) continue;
    if (i > 0) add(nodes[i - 1].key, nodes[i].key);
    else add(nodes[0].key, nodes[1].key);
  }
  return added;
}

/**
 * The fallback for an answer with no NODE lines: each bullet or numbered line is a node, and "Idea -> Plan -> Build" makes
 * the nodes (named by their text) and the links between them. Keys are made up (n1, n2, ...). Null when nothing is left.
 */
function boardFromLabels(raw: string): ParsedBoard | null {
  const L = AI_BOARD_LIMITS;
  let title = "";
  const nodes: ParsedBoard["nodes"] = [];
  const index = new Map<string, string>();
  const links: ParsedBoard["links"] = [];
  const pairs = new Set<string>();
  let dropped = 0;

  const nodeFor = (text: string): string | null => {
    const [rawLabel, rawBody] = splitDetail(plainText(text));
    const label = cut(rawLabel, L.label);
    if (!label) return null;
    const lower = label.toLowerCase();
    const have = index.get(lower);
    if (have) return have;
    if (nodes.length >= L.nodes) {
      dropped++;
      return null;
    }
    const key = `n${nodes.length + 1}`;
    index.set(lower, key);
    nodes.push({ key, label, body: cut(rawBody, L.body) });
    return key;
  };

  for (const line of linesOf(raw)) {
    const core = bare(line);
    const t = titleOf(core);
    if (t !== null) {
      if (!title) title = cut(plainText(t), L.title);
      continue;
    }
    if (ARROW.test(core)) {
      const keys = core.split(ARROW).map((k) => k.trim()).filter((k) => k.length > 0).map(nodeFor);
      for (let i = 0; i + 1 < keys.length; i++) {
        const from = keys[i];
        const to = keys[i + 1];
        if (from === null || to === null || from === to) continue;
        const id = `${from}>${to}`;
        if (pairs.has(id)) continue;
        if (links.length >= L.links) {
          dropped++;
          continue;
        }
        pairs.add(id);
        links.push({ from, to });
      }
      continue;
    }
    const b = STEP_MARK.exec(line);
    if (b) nodeFor(b[1]);
  }
  if (nodes.length === 0) return null;
  const joined = joinLoose(nodes, links, pairs);
  return { title, nodes, links, dropped, joined };
}

/** A title for a draft that came without one: the start of what was asked for. */
export function fallbackTitle(prompt: string, max = 60): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}
