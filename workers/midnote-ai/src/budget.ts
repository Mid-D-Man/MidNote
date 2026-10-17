// Pure helpers for the MidNote AI proxy: token estimates, model-result parsing, error
// classification, reset time. No I/O here, so everything is unit-testable in Node.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Deliberately OVER-estimates input tokens (utf-8 bytes / 2: English is ~4 bytes per token,
 * CJK ~3 bytes for ~1-2 tokens). The estimate only sizes the temporary HOLD; the real cost is
 * settled from the model's own token counts afterwards, so over-estimating costs nobody
 * anything - under-estimating could let the pool run past the free allowance.
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let t = 16;
  for (const m of messages) t += Math.ceil(utf8Bytes(m.content) / 2) + 8;
  return t;
}

export function secondsUntilUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Workers AI chat models answer either {response: "..."} or OpenAI-style {choices:[{message:{content}}]}. */
export function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, any>;
  const direct = str(r.response) ?? str(r.result?.response);
  if (direct !== null) return direct;
  const content = r.choices?.[0]?.message?.content ?? r.choices?.[0]?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p: any) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
  }
  return "";
}

function nonNegInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && Math.floor(v) === v ? v : null;
}

/** Real token counts, or null when the model did not report them (the ledger then charges the full hold). */
export function extractUsage(result: unknown): { inTokens: number; outTokens: number } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, any>;
  const u = r.usage ?? r.result?.usage;
  if (!u || typeof u !== "object") return null;
  const i = nonNegInt(u.prompt_tokens) ?? nonNegInt(u.input_tokens);
  const o = nonNegInt(u.completion_tokens) ?? nonNegInt(u.output_tokens);
  if (i === null || o === null) return null;
  return { inTokens: i, outTokens: o };
}

/** Reasoning models can emit <think>...</think>; people should only see the answer. */
export function stripThinking(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = t.search(/<think>/i);
  if (open !== -1) t = t.slice(0, open); // cut off mid-thought by the token limit
  return t.trim();
}

/** 'exhausted' = the provider says today's free allowance is gone (close the pool for the day). */
export function classifyAiError(e: unknown): "exhausted" | "failed" {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /\b4006\b|daily free allocation|used up your daily|neurons/i.test(msg) ? "exhausted" : "failed";
}

export class TimeoutError extends Error {
  constructor() {
    super("ai-timeout");
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
