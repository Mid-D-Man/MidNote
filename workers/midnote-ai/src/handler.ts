// MidNote AI proxy - request handler.
//
// Order of every AI call (this order IS the free-budget guarantee):
//   1. who is asking?            (Supabase verifies the access token)
//   2. is the request sane?      (size / shape caps, before anything is reserved)
//   3. RESERVE credits + pool    (the ledger refuses when the person or the shared daily pool is out)
//   4. run the model             (max_tokens = the ledger's clamped value)
//   5. SETTLE to real usage      (or RELEASE on failure; a timeout is left to expire, never released)
// If step 1 or 3 cannot be completed, step 4 never happens (fail closed).
import {
  classifyAiError,
  estimateTokens,
  extractText,
  extractUsage,
  secondsUntilUtcMidnight,
  stripThinking,
  TimeoutError,
  withTimeout,
} from "./budget";
import { configProblem, isUuid, LedgerError, rpc, verifyUser, type FetchFn, type LedgerEnv } from "./ledger";
import { buildMessages, LIMITS, parseRun, temperatureFor } from "./prompts";

export interface Env extends LedgerEnv {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  ALLOWED_ORIGINS?: string;
  AI_ENABLED?: string;
}

export interface Deps {
  fetch: FetchFn;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  aiTimeoutMs?: number;
}

const DEFAULT_ORIGINS = [
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
  "http://localhost:1420",
  "http://localhost:5173",
];

const MESSAGES: Record<string, string> = {
  "signed-out": "Sign in to use AI.",
  "bad-request": "That request wasn't understood.",
  "too-long": "That's too long for AI. Try a shorter selection.",
  "no-credits": "You're out of AI credits.",
  "daily-cap": "You've reached today's AI limit. It resets at midnight UTC.",
  busy: "Another AI request is still running.",
  "rate-limited": "Slow down a little and try again in a minute.",
  "pool-exhausted": "AI is resting for today (the free capacity is used up). It comes back at midnight UTC.",
  disabled: "AI is switched off right now.",
  "ai-unavailable": "AI is temporarily unavailable.",
  "ai-failed": "The AI didn't answer. You weren't charged.",
  timeout: "The AI took too long. You weren't charged.",
  "empty-response": "The AI returned nothing.",
  "not-found": "Not found.",
  "method-not-allowed": "Method not allowed.",
};

const STATUS: Record<string, number> = {
  "signed-out": 401,
  "bad-request": 400,
  "too-long": 413,
  "no-credits": 402,
  "daily-cap": 429,
  busy: 429,
  "rate-limited": 429,
  "pool-exhausted": 503,
  disabled: 503,
  "ai-unavailable": 503,
  "ai-failed": 502,
  timeout: 504,
  "empty-response": 502,
  "not-found": 404,
  "method-not-allowed": 405,
};

const REASON_TO_ERROR: Record<string, string> = {
  disabled: "disabled",
  "no-model": "ai-unavailable",
  "provider-off": "ai-unavailable",
  "too-long": "too-long",
  busy: "busy",
  "rate-limited": "rate-limited",
  "no-credits": "no-credits",
  "daily-cap": "daily-cap",
  "pool-exhausted": "pool-exhausted",
};

function corsFor(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ORIGINS;
  const h: Record<string, string> = { vary: "Origin" };
  if (origin && list.includes(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

function reply(status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...cors,
      ...extra,
    },
  });
}

function fail(code: string, cors: Record<string, string>, deps: Deps, extraBody: Record<string, unknown> = {}): Response {
  const body: Record<string, unknown> = { error: code, message: MESSAGES[code] ?? "Something went wrong.", ...extraBody };
  const extra: Record<string, string> = {};
  if (code === "pool-exhausted") {
    const s = secondsUntilUtcMidnight(deps.now());
    body.retry_after = s;
    extra["retry-after"] = String(s);
  }
  return reply(STATUS[code] ?? 500, body, cors, extra);
}

const TOKEN_SHAPE = /^Bearer ([A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096})$/;

async function readBody(req: Request): Promise<{ ok: true; json: unknown } | { ok: false; error: "bad-request" | "too-long" }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.body) return { ok: false, error: "too-long" };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, error: "bad-request" };
  }
  if (new TextEncoder().encode(text).length > LIMITS.body) return { ok: false, error: "too-long" };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, error: "bad-request" };
  }
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const cors = corsFor(req.headers.get("origin"), env);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  if (path === "/health") {
    return req.method === "GET" ? reply(200, { ok: true }, cors) : fail("method-not-allowed", cors, deps);
  }
  const isStatus = path === "/v1/ai/status";
  const isRun = path === "/v1/ai/run";
  if (!isStatus && !isRun) return fail("not-found", cors, deps);
  if ((isStatus && req.method !== "GET") || (isRun && req.method !== "POST")) return fail("method-not-allowed", cors, deps);

  // the Worker must be fully configured, and the owner's kill switch must be on
  if (configProblem(env) !== null || env.AI_ENABLED?.toLowerCase() === "off") return fail("ai-unavailable", cors, deps);

  // 1. who is asking?  (cheap shape check first: junk never reaches Supabase)
  const m = TOKEN_SHAPE.exec(req.headers.get("authorization") ?? "");
  if (!m) return fail("signed-out", cors, deps);
  const who = await verifyUser(env, deps.fetch, m[1]);
  if (who === "signed-out") return fail("signed-out", cors, deps);
  if (who === "unavailable") return fail("ai-unavailable", cors, deps);
  const userId = who.id;

  try {
    if (isStatus) {
      const st = await rpc(env, deps.fetch, "midnote_ai_status", { p_user: userId });
      if (!st || typeof st !== "object") throw new LedgerError("bad status");
      return reply(
        200,
        {
          enabled: !!st.enabled,
          has_account: !!st.has_account,
          balance: Number(st.balance) || 0,
          daily_cap: Number(st.daily_cap) || 0,
          daily_left: Number(st.daily_left) || 0,
          next_topup_at: typeof st.next_topup_at === "string" ? st.next_topup_at : null,
          pool_open: !!st.pool_open,
          resets_in: secondsUntilUtcMidnight(deps.now()),
        },
        cors,
      );
    }

    // 2. is the request sane?
    const body = await readBody(req);
    if (!body.ok) return fail(body.error, cors, deps);
    const parsed = parseRun(body.json);
    if (!parsed.ok) return fail(parsed.error, cors, deps);
    const messages = buildMessages(parsed.value);
    const inTokens = estimateTokens(messages);

    // 3. RESERVE
    const r = await rpc(env, deps.fetch, "midnote_ai_reserve", {
      p_user: userId,
      p_feature: parsed.value.task,
      p_in_tokens: inTokens,
      p_max_out: parsed.value.maxTokens,
      p_model: null,
    });
    if (!r || typeof r !== "object" || typeof r.ok !== "boolean") throw new LedgerError("bad reserve reply");
    if (!r.ok) {
      const code = REASON_TO_ERROR[String(r.reason)];
      if (!code) throw new LedgerError("unknown refusal");
      return fail(code, cors, deps, typeof r.balance === "number" ? { balance: r.balance } : {});
    }
    if (!isUuid(r.request_id) || typeof r.model !== "string" || !Number.isInteger(r.max_out) || r.max_out < 1) {
      throw new LedgerError("bad reserve grant");
    }
    const requestId: string = r.request_id;

    // 4. run the model
    let result: unknown;
    try {
      result = await withTimeout(
        env.AI.run(r.model, { messages, max_tokens: r.max_out, temperature: temperatureFor(parsed.value.task) }),
        deps.aiTimeoutMs ?? 45000,
      );
    } catch (e) {
      if (e instanceof TimeoutError) {
        // The model may still be running and spending neurons: do NOT release. The hold expires,
        // the pool books it as spent, the person gets their credits back.
        return fail("timeout", cors, deps);
      }
      const kind = classifyAiError(e);
      try {
        await rpc(env, deps.fetch, "midnote_ai_release", { p_request: requestId, p_exhausted: kind === "exhausted" });
      } catch {
        /* the hold expires on its own */
      }
      return fail(kind === "exhausted" ? "pool-exhausted" : "ai-failed", cors, deps);
    }

    // 5. SETTLE to the real usage (retry: this is the step that keeps the books honest)
    const text = stripThinking(extractText(result));
    const usage = extractUsage(result);
    let settled: any = null;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
    for (let attempt = 0; attempt < 3 && !settled; attempt++) {
      try {
        const s = await rpc(env, deps.fetch, "midnote_ai_settle", {
          p_request: requestId,
          p_in_tokens: usage ? usage.inTokens : null,
          p_out_tokens: usage ? usage.outTokens : null,
        });
        if (s && s.ok === true) settled = s;
      } catch {
        await sleep(150 * (attempt + 1));
      }
    }
    if (!text) return fail("empty-response", cors, deps);
    return reply(
      200,
      {
        text,
        model: r.model,
        credits_charged: settled ? Number(settled.charged) : null,
        balance: settled ? Number(settled.balance) : null,
      },
      cors,
    );
  } catch (e) {
    if (e instanceof LedgerError) return fail("ai-unavailable", cors, deps); // fail closed
    return fail("ai-unavailable", cors, deps);
  }
}
