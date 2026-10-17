// Thin Supabase REST client for the AI proxy. Plain fetch, no SDK. Everything here FAILS
// CLOSED: if the ledger or the auth check cannot be reached, nothing is spent.

export interface LedgerEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function baseUrl(env: LedgerEnv): string {
  return env.SUPABASE_URL.replace(/\/+$/, "");
}

/** New-style sb_secret_ keys go in the apikey header ONLY; a legacy service_role JWT also needs Authorization. */
export function secretHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (key.startsWith("eyJ")) h.authorization = `Bearer ${key}`;
  return h;
}

/** Why the Worker cannot run at all (null = fine). Never includes a secret value. */
export function configProblem(env: Partial<LedgerEnv> & { AI?: unknown }): string | null {
  if (!env.SUPABASE_URL || !/^https:\/\/[^/\s]+/.test(env.SUPABASE_URL)) return "SUPABASE_URL missing or not https";
  if (!env.SUPABASE_PUBLISHABLE_KEY) return "SUPABASE_PUBLISHABLE_KEY missing";
  if (!env.SUPABASE_SECRET_KEY) return "SUPABASE_SECRET_KEY missing";
  if (env.SUPABASE_SECRET_KEY === env.SUPABASE_PUBLISHABLE_KEY) return "SUPABASE_SECRET_KEY equals the publishable key";
  if (env.SUPABASE_SECRET_KEY.startsWith("sb_publishable_")) return "SUPABASE_SECRET_KEY holds a publishable key";
  if (!env.AI || typeof (env.AI as { run?: unknown }).run !== "function") return "AI binding missing";
  return null;
}

/** Ask Supabase who this access token belongs to. A logged-out / revoked token fails here. */
export async function verifyUser(
  env: LedgerEnv,
  f: FetchFn,
  token: string,
): Promise<{ id: string } | "signed-out" | "unavailable"> {
  let res: Response;
  try {
    res = await f(`${baseUrl(env)}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
    });
  } catch {
    return "unavailable";
  }
  if (res.status === 401 || res.status === 403) return "signed-out";
  if (res.status !== 200) return "unavailable";
  try {
    const body = (await res.json()) as { id?: unknown };
    return isUuid(body.id) ? { id: body.id } : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Call one of the midnote_ai_* functions as the Worker (service role). Throws LedgerError on anything unexpected. */
export async function rpc(env: LedgerEnv, f: FetchFn, name: string, args: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await f(`${baseUrl(env)}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: secretHeaders(env.SUPABASE_SECRET_KEY),
      body: JSON.stringify(args),
    });
  } catch {
    throw new LedgerError("ledger unreachable");
  }
  if (res.status !== 200) throw new LedgerError(`ledger status ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new LedgerError("ledger sent invalid json");
  }
}
