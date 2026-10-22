// Round D2 — the app's side of the AI proxy (workers/midnote-ai).
//
// Plain TypeScript with everything injected (the address, fetch, the sign-in token), so it runs in Node
// and in the jsdom smoke tests exactly as it does in the app. What it does for every call:
//   * sends the signed-in person's OWN Supabase access token to the proxy (never the publishable key,
//     never anything else) - the proxy turns that into "who is asking" and applies the credit budget;
//   * if the proxy answers 401 (the token just expired), refreshes the token ONCE and retries ONCE;
//   * turns every failure into an AiError with a small fixed set of kinds, so the screen can say something
//     human. It never puts the prompt, the answer or a token into an error.
// The proxy owns the real limits (credits, the shared daily pool, request sizes). The checks here only
// save a round trip for requests that cannot work.
import type { HttpFetch, HttpResponse } from "./authClient";

export const AI_LIMITS = { prompt: 4000, instruction: 600, text: 16000, context: 16000, note: 16000, turn: 4000, turns: 12, maxTokens: 4096 } as const;

/** What an AI answer is FOR: edit = replaces the selection, continue = text that follows it, ask = an answer about it. */
export type AiEditMode = "edit" | "continue" | "ask";

export type AiRequest =
  // `titled`: the answer is a NOTE (its first line is the title, then the body in light Markdown)
  | { task: "create"; prompt: string; titled?: boolean; maxTokens?: number }
  // `mode` makes it a SELECTION task: `text` is the selection and `before`/`after` the rest of the note around it
  | { task: "transform"; instruction: string; text: string; mode?: AiEditMode; before?: string; after?: string; maxTokens?: number }
  | { task: "chat"; note: string; messages: { role: "user" | "assistant"; content: string }[]; maxTokens?: number };

export type AiErrorKind =
  | "not-configured"
  | "signed-out"
  | "network"
  | "timeout"
  | "no-credits"
  | "daily-cap"
  | "busy"
  | "rate-limited"
  | "pool-exhausted"
  | "too-long"
  | "disabled"
  | "ai-unavailable"
  | "ai-failed"
  | "empty-response"
  | "bad-request"
  | "server";

export class AiError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
    public readonly status?: number,
    /** Seconds until it is worth trying again (pool-exhausted), as the proxy said. */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiStatus {
  enabled: boolean;
  hasAccount: boolean;
  balance: number;
  dailyCap: number;
  dailyLeft: number;
  nextTopupAt: string | null;
  poolOpen: boolean;
  /** Seconds until the next UTC midnight (when the daily numbers reset). */
  resetsIn: number;
}

export interface AiResult {
  text: string;
  model: string;
  /** Credits this answer cost; null when the proxy could not settle it yet. */
  creditsCharged: number | null;
  /** The answer used the whole output allowance, so it is probably cut off: never let it replace anything. */
  truncated: boolean;
  balance: number | null;
}

export interface AiDeps {
  /** The proxy address without a trailing slash, or null when this build has none. */
  baseUrl: string | null;
  fetch: HttpFetch;
  /** A usable access token (refreshed if about to expire). Throws when signed out. */
  getToken: () => Promise<string>;
  /** Force a refresh and return the new token. */
  refreshToken: () => Promise<string>;
}

const KINDS: ReadonlySet<string> = new Set<AiErrorKind>([
  "signed-out", "no-credits", "daily-cap", "busy", "rate-limited", "pool-exhausted", "too-long", "disabled",
  "ai-unavailable", "ai-failed", "empty-response", "bad-request", "timeout",
]);

function kindFromHttp(status: number): AiErrorKind {
  if (status === 401) return "signed-out";
  if (status === 402) return "no-credits";
  if (status === 413) return "too-long";
  if (status === 429) return "rate-limited";
  if (status === 504) return "timeout";
  if (status === 503) return "ai-unavailable";
  if (status >= 500) return "server";
  return "bad-request";
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function errorFrom(status: number, body: Record<string, unknown> | null): AiError {
  const code = body && typeof body.error === "string" ? body.error : "";
  const kind: AiErrorKind = KINDS.has(code) ? (code as AiErrorKind) : kindFromHttp(status);
  const retry = body && typeof body.retry_after === "number" && body.retry_after > 0 ? body.retry_after : undefined;
  return new AiError(kind, typeof body?.message === "string" ? body.message : kind, status, retry);
}

/** Why this request can't work, before spending a round trip on it. null = fine. */
export function checkRequest(req: AiRequest): AiError | null {
  const bad = (m: string) => new AiError("bad-request", m);
  const long = (m: string) => new AiError("too-long", m);
  if (req.maxTokens !== undefined && (!Number.isInteger(req.maxTokens) || req.maxTokens < 1 || req.maxTokens > AI_LIMITS.maxTokens)) return bad("max tokens");
  switch (req.task) {
    case "create":
      if (!req.prompt.trim()) return bad("empty prompt");
      return req.prompt.length > AI_LIMITS.prompt ? long("prompt too long") : null;
    case "transform":
      if (!req.instruction.trim() || !req.text.trim()) return bad("empty instruction or text");
      if ((req.before !== undefined || req.after !== undefined) && req.mode === undefined) return bad("context needs a mode");
      if (req.instruction.length > AI_LIMITS.instruction || req.text.length > AI_LIMITS.text) return long("text too long");
      return (req.before?.length ?? 0) > AI_LIMITS.context || (req.after?.length ?? 0) > AI_LIMITS.context ? long("context too long") : null;
    case "chat": {
      if (req.note.length > AI_LIMITS.note) return long("note too long");
      if (req.messages.length < 1) return bad("no message");
      if (req.messages.length > AI_LIMITS.turns) return long("too many messages");
      for (const m of req.messages) {
        if (!m.content.trim()) return bad("empty message");
        if (m.content.length > AI_LIMITS.turn) return long("message too long");
      }
      return req.messages[req.messages.length - 1].role === "user" ? null : bad("last message must be the person's");
    }
  }
}

export class AiClient {
  constructor(private readonly deps: AiDeps) {}

  get configured(): boolean {
    return this.deps.baseUrl !== null;
  }

  async status(): Promise<AiStatus> {
    const { status, json } = await this.call("/v1/ai/status", "GET");
    if (status !== 200) throw errorFrom(status, json);
    if (!json) throw new AiError("server", "The reply was not understood.", status);
    return {
      enabled: json.enabled === true,
      hasAccount: json.has_account === true,
      balance: num(json.balance),
      dailyCap: num(json.daily_cap),
      dailyLeft: num(json.daily_left),
      nextTopupAt: typeof json.next_topup_at === "string" ? json.next_topup_at : null,
      poolOpen: json.pool_open === true,
      resetsIn: num(json.resets_in),
    };
  }

  async run(req: AiRequest): Promise<AiResult> {
    const problem = checkRequest(req);
    if (problem) throw problem;
    const body: Record<string, unknown> = { task: req.task };
    if (req.task === "create") {
      body.prompt = req.prompt;
      if (req.titled !== undefined) body.titled = req.titled;
    } else if (req.task === "transform") {
      body.instruction = req.instruction;
      body.text = req.text;
      if (req.mode !== undefined) body.mode = req.mode;
      if (req.before !== undefined) body.before = req.before;
      if (req.after !== undefined) body.after = req.after;
    } else {
      body.note = req.note;
      body.messages = req.messages;
    }
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    const { status, json } = await this.call("/v1/ai/run", "POST", JSON.stringify(body));
    if (status !== 200) throw errorFrom(status, json);
    if (!json) throw new AiError("server", "The reply was not understood.", status);
    if (typeof json.text !== "string") throw new AiError("server", "The answer was not understood.", status);
    return {
      text: json.text,
      model: typeof json.model === "string" ? json.model : "",
      creditsCharged: typeof json.credits_charged === "number" ? json.credits_charged : null,
      balance: typeof json.balance === "number" ? json.balance : null,
      truncated: json.truncated === true,
    };
  }

  // ---------------------------------------------------------------- internals

  private async token(refresh: boolean): Promise<string> {
    try {
      return await (refresh ? this.deps.refreshToken() : this.deps.getToken());
    } catch (e) {
      const kind = (e as { kind?: string } | null)?.kind;
      if (kind === "signed-out") throw new AiError("signed-out", "Not signed in");
      if (kind === "not-configured") throw new AiError("not-configured", "Online features aren't set up");
      throw new AiError("network", "Can't reach the server");
    }
  }

  private async send(path: string, method: string, body: string | undefined, token: string): Promise<HttpResponse> {
    try {
      return await this.deps.fetch(`${this.deps.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...(body !== undefined ? { body } : {}),
      });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") throw new AiError("timeout", "The AI took too long");
      throw new AiError("network", "Can't reach the AI server");
    }
  }

  private async call(path: string, method: string, body?: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
    if (this.deps.baseUrl === null) throw new AiError("not-configured", "AI isn't set up in this build");
    let res = await this.send(path, method, body, await this.token(false));
    if (res.status === 401) {
      // the token may have expired in flight: one refresh, one retry
      res = await this.send(path, method, body, await this.token(true));
    }
    let text = "";
    try {
      text = await res.text();
    } catch {
      throw new AiError("network", "Can't reach the AI server");
    }
    return { status: res.status, json: parseJson(text) };
  }
}
