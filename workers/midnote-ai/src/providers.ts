// Where an AI request is actually answered. Cloudflare Workers AI is the primary (a Worker binding, no key,
// zero data retention). Groq and Mistral are BACKUPS: they are only tried when the primary has no capacity
// left today or errors, and only when ALL of these are true (each is a separate lock):
//   1. the Worker has that provider's API key (a GitHub secret passed by the deploy workflow),
//   2. the provider AND its model row are enabled in Supabase (midnote_ai_providers / midnote_ai_models),
//   3. the shared pool for that provider still has room today (the ledger decides).
// Nothing here talks to the ledger: handler.ts reserves / settles / releases around these calls.
import { classifyAiError, type ChatMessage } from "./budget";
import type { FetchFn } from "./ledger";

export type ProviderId = "cf" | "groq" | "mistral";

/** One thing to try: model null = "the ledger's default model" (the primary). */
export interface Candidate {
  provider: ProviderId;
  model: string | null;
}

export interface ProviderEnv {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  GROQ_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  /** "groq:<model>,mistral:<model>" in the order to try, or "off" for no backups. */
  AI_BACKUPS?: string;
}

export interface ModelInput {
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
}

/** Model ids must match the ids in midnote_ai_models. Both are production models on their free plans. */
export const DEFAULT_BACKUPS = "groq:llama-3.3-70b-versatile,mistral:mistral-small-latest";

const ENDPOINTS: Record<"groq" | "mistral", string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const MAX_BACKUPS = 4;

export function isProviderId(v: unknown): v is ProviderId {
  return v === "cf" || v === "groq" || v === "mistral";
}

/** The key a provider needs ("" = none needed or missing). Never logged, never returned. */
export function keyFor(provider: ProviderId, env: ProviderEnv): string {
  const k = provider === "groq" ? env.GROQ_API_KEY : provider === "mistral" ? env.MISTRAL_API_KEY : "";
  return typeof k === "string" ? k.trim() : "";
}

/** Can this provider be called at all right now? (cf only needs the binding, checked elsewhere.) */
export function providerReady(provider: ProviderId, env: ProviderEnv): boolean {
  return provider === "cf" || keyFor(provider, env) !== "";
}

/** Parse AI_BACKUPS. Bad entries are ignored (never throw): a typo must not take the primary down. */
export function parseBackups(raw: string | undefined): Candidate[] {
  const text = (raw === undefined ? DEFAULT_BACKUPS : raw).trim();
  if (text === "" || text.toLowerCase() === "off") return [];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const provider = part.slice(0, i).trim().toLowerCase();
    const model = part.slice(i + 1).trim();
    if ((provider !== "groq" && provider !== "mistral") || !MODEL_ID.test(model) || seen.has(model)) continue;
    seen.add(model);
    out.push({ provider, model });
    if (out.length >= MAX_BACKUPS) break;
  }
  return out;
}

/** The primary first, then every configured backup whose key is present. */
export function candidatesFor(env: ProviderEnv): Candidate[] {
  const list: Candidate[] = [{ provider: "cf", model: null }];
  for (const c of parseBackups(env.AI_BACKUPS)) if (providerReady(c.provider, env)) list.push(c);
  return list;
}

/** A non-200 from a provider. `snippet` is only used to classify the failure; it is never sent to the phone. */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly snippet: string,
  ) {
    super(`${provider} http ${status}`);
    this.name = "ProviderHttpError";
  }
}

async function runHttp(provider: "groq" | "mistral", model: string, input: ModelInput, env: ProviderEnv, f: FetchFn): Promise<unknown> {
  const key = keyFor(provider, env);
  if (!key) throw new ProviderHttpError(provider, 401, "no key");
  const res = await f(ENDPOINTS[provider], {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: input.messages,
      max_tokens: input.max_tokens,
      temperature: input.temperature,
      stream: false,
    }),
  });
  if (!res.ok) {
    let snippet = "";
    try {
      snippet = (await res.text()).slice(0, 400);
    } catch {
      /* classification just sees an empty body */
    }
    throw new ProviderHttpError(provider, res.status, snippet);
  }
  try {
    return await res.json();
  } catch {
    throw new ProviderHttpError(provider, 502, "invalid json");
  }
}

/** Run one model on one provider. The answer has the same shape the primary returns (budget.ts reads both). */
export function runProvider(provider: ProviderId, model: string, input: ModelInput, env: ProviderEnv, f: FetchFn): Promise<unknown> {
  if (provider === "cf") return env.AI.run(model, input);
  return runHttp(provider, model, input, env, f);
}

/**
 * 'exhausted' = the provider says TODAY's free allowance is gone: the ledger closes that provider's pool until
 * midnight UTC. Everything else (a per-minute limit, a bad request, a 5xx, an unknown 429) is just 'failed' for
 * this one request. Mistral's 429 cannot be told apart (per second / per minute / per month) so it never closes
 * the day; Groq names the limit ("... tokens per day (TPD)"), and only the daily ones do.
 */
export function classifyProviderError(provider: ProviderId, e: unknown): "exhausted" | "failed" {
  if (provider === "cf") return classifyAiError(e);
  if (provider === "groq" && e instanceof ProviderHttpError && e.status === 429) {
    return /tokens per day|requests per day|\(TPD\)|\(RPD\)/i.test(e.snippet) ? "exhausted" : "failed";
  }
  return "failed";
}
