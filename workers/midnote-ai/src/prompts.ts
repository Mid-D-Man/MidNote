// What the phone may ask for. The server owns the system prompts, so the endpoint is a note
// assistant and not a general-purpose chatbot, and prompts can change without an APK release.
import type { ChatMessage } from "./budget";

export const LIMITS = {
  body: 65536, // bytes
  prompt: 4000,
  instruction: 600,
  text: 16000,
  note: 16000,
  turn: 4000,
  turns: 12,
  maxTokens: 4096,
} as const;

export type RunRequest =
  | { task: "create"; prompt: string; maxTokens: number | null }
  | { task: "transform"; instruction: string; text: string; maxTokens: number | null }
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
      return { ok: true, value: { task: "create", prompt: raw.prompt.trim(), maxTokens } };
    }
    case "transform": {
      if (typeof raw.instruction !== "string" || !raw.instruction.trim()) return bad;
      if (typeof raw.text !== "string" || !raw.text.trim()) return bad;
      if (raw.instruction.length > LIMITS.instruction || raw.text.length > LIMITS.text) return long;
      return { ok: true, value: { task: "transform", instruction: raw.instruction.trim(), text: raw.text, maxTokens } };
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

const TRANSFORM_SYSTEM =
  "You edit text inside a note-taking app. Apply the user's instruction to the text they give you. " +
  "Keep the original language unless told otherwise. Output only the resulting text: no preamble, no explanation.";

const CHAT_SYSTEM =
  "You answer questions about one note in a note-taking app. The note is between the NOTE markers. " +
  "Answer from the note; if the answer is not in it, say so briefly. Be concise and reply in the user's language.";

export function temperatureFor(task: RunRequest["task"]): number {
  return task === "create" ? 0.7 : task === "transform" ? 0.3 : 0.5;
}

export function buildMessages(req: RunRequest): ChatMessage[] {
  switch (req.task) {
    case "create":
      return [
        { role: "system", content: CREATE_SYSTEM },
        { role: "user", content: req.prompt },
      ];
    case "transform":
      return [
        { role: "system", content: TRANSFORM_SYSTEM },
        { role: "user", content: `Instruction: ${req.instruction}\n\nText:\n${req.text}` },
      ];
    case "chat":
      return [
        { role: "system", content: `${CHAT_SYSTEM}\n\n--- NOTE ---\n${req.note}\n--- END NOTE ---` },
        ...req.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      ];
  }
}
