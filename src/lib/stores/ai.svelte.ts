// Round D2 — the AI, as the rest of the app sees it: whether it is set up, the credit numbers, and one
// way to ask. A thin runes wrapper over online/aiClient.ts (which holds the rules).
//
// Local-first stays true: nothing here runs until someone opens an AI screen, and nothing is stored.
// The debug log gets the kind of task, the model, the credits and the failure kind - never the
// prompt, the answer or a token. Writes `ai` only from handlers, never from an $effect
// (docs/svelte5-effect-safety.md).
import { AiClient, AiError, type AiRequest, type AiResult, type AiStatus } from "$lib/online/aiClient";
import { friendlyAiMessage } from "$lib/online/aiMessages";
import { realHttpFetch } from "$lib/online/authClient";
import { getAiProxyUrl } from "$lib/online/config";
import { accountClient } from "$lib/stores/account.svelte";
import { breadcrumb } from "$lib/debug/log.svelte";

export const ai = $state({
  /** This build knows where the AI proxy is. */
  configured: false,
  status: null as AiStatus | null,
  loading: false,
  /** Why the last status refresh failed (already in plain language). */
  statusError: null as string | null,
});

let client: AiClient | null = null;

/** Idempotent. Call when an AI screen opens. Never throws. */
export function initAi(): void {
  if (client) return;
  const seam = globalThis.__midnoteOnline;
  const url = getAiProxyUrl();
  ai.configured = url !== null;
  client = new AiClient({
    baseUrl: url,
    // AI answers take a while: 60 s instead of the 20 s the account calls use
    fetch: seam?.fetch ?? realHttpFetch(60_000),
    getToken: async () => {
      const c = accountClient();
      if (!c) throw new AiError("not-configured", "Online features aren't set up");
      return c.accessToken();
    },
    refreshToken: async () => {
      const c = accountClient();
      if (!c) throw new AiError("not-configured", "Online features aren't set up");
      return (await c.refresh()).accessToken;
    },
  });
}

function nowMs(): number {
  return (globalThis.__midnoteOnline?.now ?? Date.now)();
}

function describe(e: unknown): string {
  return e instanceof AiError ? `${e.kind}${e.status ? ` ${e.status}` : ""}` : "error";
}

/** Reloads the credit numbers. Never throws; failures land in ai.statusError. */
export async function refreshAiStatus(): Promise<void> {
  initAi();
  if (!client || !client.configured) return;
  ai.loading = true;
  try {
    ai.status = await client.status();
    ai.statusError = null;
    breadcrumb(`ai: status ok (balance ${ai.status.balance}, pool ${ai.status.poolOpen ? "open" : "closed"})`);
  } catch (e) {
    ai.statusError = e instanceof AiError ? friendlyAiMessage(e, nowMs()) : "Couldn't load your AI credits.";
    breadcrumb(`ai: status failed (${describe(e)})`);
  } finally {
    ai.loading = false;
  }
}

export type AiRunResult = { ok: true; result: AiResult } | { ok: false; error: AiError; message: string };

/** Asks the AI. Never throws. On success the shown credit numbers are updated from the answer. */
export async function runAi(req: AiRequest): Promise<AiRunResult> {
  initAi();
  if (!client) return { ok: false, error: new AiError("not-configured", "not set up"), message: "AI isn't set up in this build." };
  try {
    const result = await client.run(req);
    breadcrumb(`ai: ${req.task} ok (model ${result.model || "?"}, charged ${result.creditsCharged ?? "?"})`);
    if (ai.status) {
      if (result.balance !== null) ai.status = { ...ai.status, balance: result.balance };
      if (result.creditsCharged !== null) ai.status = { ...ai.status, dailyLeft: Math.max(0, ai.status.dailyLeft - result.creditsCharged) };
    }
    return { ok: true, result };
  } catch (e) {
    const error = e instanceof AiError ? e : new AiError("server", "unexpected");
    breadcrumb(`ai: ${req.task} failed (${describe(error)})`);
    // the numbers on screen may be stale now: reload them quietly
    if (error.kind === "no-credits" || error.kind === "daily-cap" || error.kind === "pool-exhausted" || error.kind === "busy") void refreshAiStatus();
    return { ok: false, error, message: friendlyAiMessage(error, nowMs()) };
  }
}
