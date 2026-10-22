// What the phone may ask for. The server owns the system prompts, so the endpoint is a note
// assistant and not a general-purpose chatbot, and prompts can change without an APK release.
import { estimateTokens, utf8Bytes, type ChatMessage } from "./budget";

export const LIMITS = {
  body: 65536, // bytes
  prompt: 4000,
  instruction: 600,
  text: 16000,
  /** The text before / after a selection (each), as the phone sends it. The server trims it further. */
  context: 16000,
  note: 16000,
  turn: 4000,
  turns: 12,
  maxTokens: 4096,
} as const;

/**
 * The ledger refuses a request whose ESTIMATED input is over the model's max_input_tokens (8000 by
 * default). Selection edits stay under this ceiling by trimming the surrounding note text, so a long
 * note never makes an edit fail: only a selection that is itself too long does.
 */
export const INPUT_TOKEN_CEILING = 7600;

/** edit = the answer replaces the selection; continue = new text that follows it; ask = an answer about it. */
export type TransformMode = "edit" | "continue" | "ask";

export type RunRequest =
  | { task: "create"; prompt: string; titled: boolean; maxTokens: number | null }
  | { task: "transform"; instruction: string; text: string; mode: TransformMode | null; before: string; after: string; maxTokens: number | null }
  | { task: "chat"; note: string; messages: { role: "user" | "assistant"; content: string }[]; maxTokens: number | null };

export type ParseResult = { ok: true; value: RunRequest } | { ok: false; error: "bad-request" | "too-long" };

const bad: ParseResult = { ok: false, error: "bad-request" };
const long: ParseResult = { ok: false, error: "too-long" };

function plain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function parseRun(raw: unknown): ParseResult {
  if (!plain(raw)) return bad;
  let maxTokens: number | null = null;
  if (raw.max_tokens !== undefined && raw.max_tokens !== null) {
    const m = raw.max_tokens;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > LIMITS.maxTokens) return bad;
    maxTokens = m;
  }
  switch (raw.task) {
    case "create": {
      if (typeof raw.prompt !== "string" || !raw.prompt.trim()) return bad;
      if (raw.prompt.length > LIMITS.prompt) return long;
      // titled: the answer is a NOTE (a title line, then the body) rather than free text
      if (raw.titled !== undefined && typeof raw.titled !== "boolean") return bad;
      return { ok: true, value: { task: "create", prompt: raw.prompt.trim(), titled: raw.titled === true, maxTokens } };
    }
    case "transform": {
      if (typeof raw.instruction !== "string" || !raw.instruction.trim()) return bad;
      if (typeof raw.text !== "string" || !raw.text.trim()) return bad;
      let mode: TransformMode | null = null;
      if (raw.mode !== undefined && raw.mode !== null) {
        if (raw.mode !== "edit" && raw.mode !== "continue" && raw.mode !== "ask") return bad;
        mode = raw.mode;
      }
      let before = "";
      let after = "";
      if (raw.before !== undefined || raw.after !== undefined) {
        // the note around a selection only makes sense for a selection task
        if (mode === null) return bad;
        if (raw.before !== undefined && typeof raw.before !== "string") return bad;
        if (raw.after !== undefined && typeof raw.after !== "string") return bad;
        before = (raw.before as string | undefined) ?? "";
        after = (raw.after as string | undefined) ?? "";
      }
      if (raw.instruction.length > LIMITS.instruction || raw.text.length > LIMITS.text) return long;
      if (before.length > LIMITS.context || after.length > LIMITS.context) return long;
      return { ok: true, value: { task: "transform", instruction: raw.instruction.trim(), text: raw.text, mode, before, after, maxTokens } };
    }
    case "chat": {
      if (typeof raw.note !== "string") return bad;
      if (raw.note.length > LIMITS.note) return long;
      if (!Array.isArray(raw.messages) || raw.messages.length < 1) return bad;
      if (raw.messages.length > LIMITS.turns) return long;
      const turns: { role: "user" | "assistant"; content: string }[] = [];
      for (const t of raw.messages) {
        if (!plain(t) || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string") return bad;
        if (!t.content.trim()) return bad;
        if (t.content.length > LIMITS.turn) return long;
        turns.push({ role: t.role, content: t.content });
      }
      if (turns[turns.length - 1].role !== "user") return bad;
      return { ok: true, value: { task: "chat", note: raw.note, messages: turns, maxTokens } };
    }
    default:
      return bad;
  }
}

const CREATE_SYSTEM =
  "You are the writing assistant inside a note-taking app. Write the note the user asks for. " +
  "Use plain text with simple Markdown (short headings, bullet lists) where it helps. " +
  "Reply in the language of the request. Output only the note itself: no preamble, no closing remarks.";

// a note for the app to file: the first line is its title (round G, the landing page's "Create with AI")
const CREATE_NOTE_SYSTEM =
  "You write notes inside a note-taking app. Write the note the user asks for. " +
  "Reply in exactly this shape: the first line is a short title (at most 8 words, plain text: no #, no quotes), then one empty line, then the note itself. " +
  "In the note use plain paragraphs, lines that start with '- ' for bullet lists, lines that start with '1. ' for numbered lists, and **bold** for emphasis; no tables and no # headings. " +
  "Reply in the language of the request. No preamble and no closing remarks.";

// the original, context-free transform (Settings -> AI "Edit text")
const TRANSFORM_SYSTEM =
  "You edit text inside a note-taking app. Apply the user's instruction to the text they give you. " +
  "Keep the original language unless told otherwise. Output only the resulting text: no preamble, no explanation.";

const SELECTION_NOTE =
  "The whole note is shown for context, with the selection between [[SELECTION]] and [[/SELECTION]]. " +
  "A line that is only […] means the note continues there.";

const EDIT_SYSTEM =
  "You edit a selected part of a note inside a note-taking app. Apply the user's instruction to the SELECTION only. " +
  SELECTION_NOTE +
  " The rest of the note is only there so you understand it: never repeat it and never change it. " +
  "Keep the language, voice and style of the note unless the instruction says otherwise. " +
  "Output ONLY the replacement for the selection, as plain text without Markdown: no preamble, no explanation, " +
  "no quotation marks around it, and no [[SELECTION]] markers.";

const CONTINUE_SYSTEM =
  "You continue a note inside a note-taking app. " +
  SELECTION_NOTE +
  " Write the text that comes right after the selection, following the user's instruction, in the same language, voice and style as the note. " +
  "Output ONLY the new text, as plain text without Markdown: do not repeat the selection or the rest of the note, " +
  "and add no preamble, no explanation and no [[SELECTION]] markers.";

const ASK_SYSTEM =
  "You answer a question about a selected part of a note inside a note-taking app. " +
  SELECTION_NOTE +
  " Answer from the note; if the answer is not in it, say so briefly. Be concise, plain text without Markdown, and reply in the language of the question.";

const CHAT_SYSTEM =
  "You answer questions about one note in a note-taking app. The note is between the NOTE markers; if it has several pages, each starts with a line like --- Page 2 ---. " +
  "A line that is only […] means part of the note was left out. " +
  "Answer from the note; if the answer is not in it, say so briefly. " +
  "Be concise, use plain text (no Markdown headings or tables; short lines starting with '- ' are fine) and reply in the user's language.";

export function temperatureFor(req: RunRequest): number {
  switch (req.task) {
    case "create":
      return 0.7;
    case "transform":
      return req.mode === "continue" ? 0.6 : req.mode === "ask" ? 0.5 : 0.3;
    case "chat":
      return 0.5;
  }
}

// ---------------------------------------------------------------- selection context

/** Keeps a note's own text from forging the selection markers. */
export function defuse(s: string): string {
  return s.replace(/\[\[(\/?)SELECTION\]\]/gi, "[ [$1SELECTION] ]");
}

function headBytes(s: string, max: number): string {
  if (max <= 0) return "";
  let used = 0;
  let out = "";
  for (const ch of s) {
    const b = utf8Bytes(ch);
    if (used + b > max) break;
    used += b;
    out += ch;
  }
  return out;
}

function tailBytes(s: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(s);
  let used = 0;
  let start = chars.length;
  while (start > 0) {
    const b = utf8Bytes(chars[start - 1]);
    if (used + b > max) break;
    used += b;
    start--;
  }
  return chars.slice(start).join("");
}

const SNAP = 40; // how far a cut may move to land on a word boundary
const CUT_MARK_BYTES = 16; // "[…]\n" + "\n[…]" is 12 bytes; 4 spare for rounding

export interface ContextWindow {
  before: string;
  after: string;
  cutBefore: boolean;
  cutAfter: boolean;
}

/**
 * Fits the note text around a selection into `availBytes`, keeping what is NEAREST the selection.
 * The side that needs less keeps all of it and the other side gets the rest; cuts land on a word
 * boundary when one is close.
 */
export function windowContext(before: string, after: string, availBytes: number): ContextWindow {
  const avail = Math.max(0, Math.floor(availBytes));
  const bb = utf8Bytes(before);
  const ab = utf8Bytes(after);
  if (bb + ab <= avail) return { before, after, cutBefore: false, cutAfter: false };
  const half = Math.floor(avail / 2);
  let keepB: number;
  let keepA: number;
  if (bb <= half) {
    keepB = bb;
    keepA = avail - bb;
  } else if (ab <= half) {
    keepA = ab;
    keepB = avail - ab;
  } else {
    keepB = half;
    keepA = avail - half;
  }
  let b = before;
  let a = after;
  let cutBefore = false;
  let cutAfter = false;
  if (bb > keepB) {
    cutBefore = true;
    b = tailBytes(before, keepB);
    const m = /\s/.exec(b.slice(0, SNAP));
    if (m && b.length > m.index + 1) b = b.slice(m.index + 1);
  }
  if (ab > keepA) {
    cutAfter = true;
    a = headBytes(after, keepA);
    const tail = a.slice(Math.max(0, a.length - SNAP));
    const idx = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf("\n"), tail.lastIndexOf("\t"));
    if (idx > 0) a = a.slice(0, a.length - tail.length + idx);
  }
  return { before: b, after: a, cutBefore, cutAfter };
}

// ---------------------------------------------------------------- chat: the note and the conversation

/** The part of the input budget the conversation so far may take; the note gets the rest. */
const HISTORY_SHARE = 0.4;

function turnTokens(content: string): number {
  return Math.ceil(utf8Bytes(content) / 2) + 8; // the same arithmetic as estimateTokens
}

/**
 * The newest turns that fit `budgetTokens` (always at least the last one: that is the question), starting with a
 * person's turn. Older turns are forgotten rather than refusing the request.
 */
export function windowTurns<T extends { role: "user" | "assistant"; content: string }>(turns: T[], budgetTokens: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turnTokens(turns[i].content);
    if (kept.length > 0 && used + cost > budgetTokens) break;
    kept.unshift(turns[i]);
    used += cost;
  }
  while (kept.length > 1 && kept[0].role === "assistant") kept.shift();
  return kept;
}

/** A note too big for its share: its start and its end are kept (60 / 40), the middle becomes "[…]". */
export function windowNote(note: string, availBytes: number): string {
  const avail = Math.max(0, Math.floor(availBytes));
  if (utf8Bytes(note) <= avail) return note;
  const headBudget = Math.floor(avail * 0.6);
  let head = headBytes(note, headBudget);
  let tail = tailBytes(note, avail - headBudget);
  const tailSnap = /\s/.exec(tail.slice(0, SNAP));
  if (tailSnap && tail.length > tailSnap.index + 1) tail = tail.slice(tailSnap.index + 1);
  const headTail = head.slice(Math.max(0, head.length - SNAP));
  const idx = Math.max(headTail.lastIndexOf(" "), headTail.lastIndexOf("\n"), headTail.lastIndexOf("\t"));
  if (idx > 0) head = head.slice(0, head.length - headTail.length + idx);
  return `${head}\n[…]\n${tail}`;
}

function chatMessages(req: Extract<RunRequest, { task: "chat" }>): ChatMessage[] {
  const system = (note: string) => `${CHAT_SYSTEM}\n\n--- NOTE ---\n${note}\n--- END NOTE ---`;
  const history = windowTurns(req.messages, Math.floor(INPUT_TOKEN_CEILING * HISTORY_SHARE));
  const turns = history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage);
  const base = estimateTokens([{ role: "system", content: system("") }, ...turns]);
  const avail = Math.max(0, (INPUT_TOKEN_CEILING - base) * 2 - CUT_MARK_BYTES);
  return [{ role: "system", content: system(windowNote(req.note, avail)) }, ...turns];
}

function selectionMessages(system: string, label: string, req: Extract<RunRequest, { task: "transform" }>, w: ContextWindow): ChatMessage[] {
  const note =
    (w.cutBefore ? "[…]\n" : "") +
    defuse(w.before) +
    "[[SELECTION]]" +
    defuse(req.text) +
    "[[/SELECTION]]" +
    defuse(w.after) +
    (w.cutAfter ? "\n[…]" : "");
  return [
    { role: "system", content: system },
    { role: "user", content: `${label}: ${req.instruction}\n\nNOTE:\n${note}` },
  ];
}

export function buildMessages(req: RunRequest): ChatMessage[] {
  switch (req.task) {
    case "create":
      return [
        { role: "system", content: req.titled ? CREATE_NOTE_SYSTEM : CREATE_SYSTEM },
        { role: "user", content: req.prompt },
      ];
    case "transform": {
      if (req.mode === null) {
        return [
          { role: "system", content: TRANSFORM_SYSTEM },
          { role: "user", content: `Instruction: ${req.instruction}\n\nText:\n${req.text}` },
        ];
      }
      const system = req.mode === "edit" ? EDIT_SYSTEM : req.mode === "continue" ? CONTINUE_SYSTEM : ASK_SYSTEM;
      const label = req.mode === "ask" ? "Question" : "Instruction";
      const base = estimateTokens(selectionMessages(system, label, req, { before: "", after: "", cutBefore: false, cutAfter: false }));
      // estimateTokens counts utf-8 bytes / 2, so the spare tokens are worth twice as many bytes; the two
      // "[…]" cut marks (12 bytes) and rounding are not in `base`, so room is kept for them
      const avail = Math.max(0, (INPUT_TOKEN_CEILING - base) * 2 - CUT_MARK_BYTES);
      return selectionMessages(system, label, req, windowContext(req.before, req.after, avail));
    }
    case "chat":
      return chatMessages(req);
  }
}

// ---------------------------------------------------------------- tidying the model's answer

const OPEN_MARK = "[[SELECTION]]";
const CLOSE_MARK = "[[/SELECTION]]";

/**
 * Small models add things nobody asked for around a rewrite. This removes the common ones from an
 * edit/continue answer (echoed markers, a code fence around everything, "Here is the text:", quotes
 * around everything, **bold** the note never had) and leaves the rest untouched. Ask answers and the
 * older context-free tasks are only trimmed. It never invents or rewrites words.
 */
const FENCED = /^```[A-Za-z0-9_-]*[ \t]*\n([\s\S]*?)\n?```$/;
const PREAMBLE = /^(?:(?:sure|certainly|of course|okay|ok|absolutely)[!,.]?\s+)?(?:here(?:'s| is| are)|below is)\b[^\n]{0,100}:[ \t]*\n+/i;
const BOLD = /\*\*([^*\n]+?)\*\*/g;

export function cleanReply(req: RunRequest, raw: string): string {
  let t = raw.trim();
  // a titled note keeps its Markdown (the phone turns it into real formatting); only the wrapping goes
  if (req.task === "create") {
    if (!req.titled) return t;
    const f = FENCED.exec(t);
    if (f) t = f[1].trim();
    return t.replace(PREAMBLE, "").trim();
  }
  // a chat answer is shown as plain text, so bold markers are removed
  if (req.task === "chat") return t.replace(BOLD, "$1");
  if (req.task !== "transform" || req.mode === null || req.mode === "ask") return t;

  const open = t.indexOf(OPEN_MARK);
  const close = t.indexOf(CLOSE_MARK);
  if (open !== -1 && close > open) t = t.slice(open + OPEN_MARK.length, close);
  else t = t.split(OPEN_MARK).join("").split(CLOSE_MARK).join("");
  t = t.trim();

  const fenced = FENCED.exec(t);
  if (fenced) t = fenced[1].trim();

  t = t.replace(PREAMBLE, "").trim();

  const src = req.text.trimStart();
  const pairs: [string, string][] = [
    ['"', '"'],
    ["\u201C", "\u201D"],
  ];
  for (const [l, r] of pairs) {
    if (t.length >= 2 && t.startsWith(l) && t.endsWith(r) && !src.startsWith(l)) {
      const inner = t.slice(1, -1);
      if (!inner.includes(l) && !inner.includes(r)) t = inner.trim();
      break;
    }
  }

  if (!req.text.includes("**")) t = t.replace(BOLD, "$1");

  if (req.mode === "continue") {
    const sel = req.text.trim();
    if (sel && t.startsWith(sel) && t.length > sel.length) t = t.slice(sel.length).trimStart();
  }
  return t.trim();
}
