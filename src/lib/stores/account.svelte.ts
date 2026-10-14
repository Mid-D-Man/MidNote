// Round B — the signed-in person, as the rest of the app sees it.
//
// A thin runes wrapper over online/authClient.ts (which holds all the rules). The app is
// local-first: with no account everything works exactly as before; an account is only
// for sync and AI, which come in later rounds.
//
// Writes `account` only from event handlers / onMount / client callbacks, never from an
// $effect (see docs/svelte5-effect-safety.md).
import { AuthClient, AuthError, realHttpFetch, type AuthDeps } from "$lib/online/authClient";
import { getOnlineConfig, type ConfigProblem } from "$lib/online/config";
import { ensureMidNoteEnrolment, type EnrolOutcome } from "$lib/online/enrol";
import { breadcrumb } from "$lib/debug/log.svelte";

const SESSION_KEY = "midnote:session";
const ENROLLED_KEY = "midnote:enrolled-user";

export const account = $state({
  /** The build has a usable Supabase address + publishable key. */
  configured: false,
  /** Why not, when it isn't. */
  problem: null as ConfigProblem | null,
  signedIn: false,
  email: null as string | null,
});

let client: AuthClient | null = null;
let enrolAttemptedFor: string | null = null;

function localStore() {
  return {
    get: () => {
      try {
        return typeof localStorage === "undefined" ? null : localStorage.getItem(SESSION_KEY);
      } catch {
        return null;
      }
    },
    set: (v: string) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(SESSION_KEY, v);
    },
    clear: () => {
      if (typeof localStorage !== "undefined") localStorage.removeItem(SESSION_KEY);
    },
  };
}

function publish() {
  const s = client?.current() ?? null;
  account.signedIn = s !== null;
  account.email = s ? s.user.email : null;
}

/** Idempotent. Call once at startup (root layout). Never throws. */
export function initAccount(): void {
  if (client) return;
  const seam = globalThis.__midnoteOnline;
  const cfg = getOnlineConfig();
  account.configured = cfg.ok;
  account.problem = cfg.ok ? null : cfg.problem;
  if (!cfg.ok && cfg.problem !== "missing") breadcrumb(`account: online settings refused (${cfg.problem})`);
  const deps: AuthDeps = {
    config: cfg.ok ? cfg.config : null,
    fetch: seam?.fetch ?? realHttpFetch(),
    now: seam?.now ?? (() => Date.now()),
    store: localStore(),
  };
  client = new AuthClient(deps);
  client.onChange(publish);
  publish();
  if (account.signedIn) void enrolSoon();
}

/** The client the sync round will use. Null until initAccount() ran. */
export function accountClient(): AuthClient | null {
  return client;
}

export type AccountResult = { ok: true } | { ok: false; error: AuthError };

/** What goes in the debug log about a failure: the kind and HTTP status, plus the server's own
 *  words for server-side problems (e.g. a database trigger rejecting a new user). Never tokens
 *  or passwords: error messages never contain them. */
function describe(e: unknown): string {
  if (!(e instanceof AuthError)) return "error";
  const detail = e.kind === "server" || e.kind === "unknown" ? `: ${e.message.slice(0, 160)}` : "";
  return `${e.kind}${e.status ? ` ${e.status}` : ""}${detail}`;
}

function fail(e: unknown): AccountResult {
  return { ok: false, error: e instanceof AuthError ? e : new AuthError("unknown", "Unexpected error") };
}

export async function signInWith(email: string, password: string): Promise<AccountResult> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  try {
    await client.signIn(email, password);
    breadcrumb("account: signed in");
    void enrolSoon();
    return { ok: true };
  } catch (e) {
    breadcrumb(`account: sign-in failed (${describe(e)})`);
    return fail(e);
  }
}

/** ok + signedIn:false means "check your email" (the project requires confirmation). */
export async function signUpWith(email: string, password: string): Promise<AccountResult & { signedIn?: boolean }> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  try {
    const { session } = await client.signUp(email, password);
    breadcrumb(session ? "account: signed up and in" : "account: sign-up sent (confirmation pending)");
    if (session) void enrolSoon();
    return { ok: true, signedIn: session !== null };
  } catch (e) {
    breadcrumb(`account: sign-up failed (${describe(e)})`);
    return fail(e);
  }
}

export async function resendConfirmation(email: string): Promise<AccountResult> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  try {
    await client.resendConfirmation(email);
    return { ok: true };
  } catch (e) {
    breadcrumb(`account: resend failed (${describe(e)})`);
    return fail(e);
  }
}

export async function sendPasswordReset(email: string): Promise<AccountResult> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  try {
    await client.recoverPassword(email);
    return { ok: true };
  } catch (e) {
    breadcrumb(`account: password reset failed (${describe(e)})`);
    return fail(e);
  }
}

export async function signOutNow(): Promise<void> {
  if (!client) return;
  await client.signOut();
  breadcrumb("account: signed out");
}

// ----- registering the person as a MidNote user in the shared studio project

function readEnrolledUser(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(ENROLLED_KEY);
  } catch {
    return null;
  }
}

/** Once per app run for each person, and never again for one it already worked for. Never throws. */
async function enrolSoon(): Promise<EnrolOutcome | null> {
  const s = client?.current();
  if (!client || !s) return null;
  if (readEnrolledUser() === s.user.id) return "already";
  if (enrolAttemptedFor === s.user.id) return null;
  enrolAttemptedFor = s.user.id;
  const outcome = await ensureMidNoteEnrolment(client, s.user.id);
  breadcrumb(`account: MidNote enrolment -> ${outcome}`);
  if (outcome === "enrolled" || outcome === "already") {
    try {
      localStorage.setItem(ENROLLED_KEY, s.user.id);
    } catch {
      /* try again next run */
    }
  }
  return outcome;
}
