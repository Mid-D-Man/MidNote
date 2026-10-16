// Round B — the signed-in person, as the rest of the app sees it.
//
// A thin runes wrapper over online/authClient.ts (which holds all the rules). The app is
// local-first: with no account everything works exactly as before; an account is only
// for sync and AI, which come in later rounds.
//
// Writes `account` only from event handlers / onMount / client callbacks, never from an
// $effect (see docs/svelte5-effect-safety.md).
import { AuthClient, AuthError, realHttpFetch, type AuthDeps } from "$lib/online/authClient";
import { emailFlowsEnabled, getOnlineConfig, PORTAL_URL, type ConfigProblem } from "$lib/online/config";
import { OAUTH_REDIRECT_URI, realDeepLinkBackend } from "$lib/online/deepLink";
import { friendlyAuthMessage } from "$lib/online/authMessages";
import { pushToast } from "$lib/stores/toast.svelte";
import { ensureMidNoteEnrolment, type EnrolOutcome } from "$lib/online/enrol";
import { breadcrumb } from "$lib/debug/log.svelte";

const SESSION_KEY = "midnote:session";
const ENROLLED_KEY = "midnote:enrolled-user";
const OAUTH_KEY = "midnote:oauth-pending";

export const account = $state({
  /** The build has a usable Supabase address + publishable key. */
  configured: false,
  /** Why not, when it isn't. */
  problem: null as ConfigProblem | null,
  signedIn: false,
  email: null as string | null,
  /** The email-dependent flows are switched on in this build (see emailFlowsEnabled). */
  emailFlows: false,
  /** A Google sign-in is open in the browser and we're waiting for it to come back. */
  oauthPending: false,
  /** Why the last Google sign-in didn't finish (shown in the sign-in dialog). */
  oauthMessage: null as string | null,
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

function oauthStore() {
  return {
    get: () => {
      try {
        return typeof localStorage === "undefined" ? null : localStorage.getItem(OAUTH_KEY);
      } catch {
        return null;
      }
    },
    set: (v: string) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(OAUTH_KEY, v);
    },
    clear: () => {
      if (typeof localStorage !== "undefined") localStorage.removeItem(OAUTH_KEY);
    },
  };
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
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
  account.emailFlows = emailFlowsEnabled();
  account.problem = cfg.ok ? null : cfg.problem;
  if (!cfg.ok && cfg.problem !== "missing") breadcrumb(`account: online settings refused (${cfg.problem})`);
  const deps: AuthDeps = {
    config: cfg.ok ? cfg.config : null,
    fetch: seam?.fetch ?? realHttpFetch(),
    now: seam?.now ?? (() => Date.now()),
    store: localStore(),
    recoverRedirectTo: PORTAL_URL,
    oauth: { redirectUri: OAUTH_REDIRECT_URI, store: oauthStore(), randomBytes },
  };
  client = new AuthClient(deps);
  client.onChange(publish);
  publish();
  if (account.signedIn) void enrolSoon();
  void startDeepLinks();
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
export async function signUpWith(email: string, password: string, name: string): Promise<AccountResult & { signedIn?: boolean }> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  try {
    const { session } = await client.signUp(email, password, name);
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

/** Set or change the password of the signed-in person (no email involved). */
export async function setPassword(password: string): Promise<AccountResult> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  try {
    await client.updatePassword(password);
    breadcrumb("account: password saved");
    return { ok: true };
  } catch (e) {
    breadcrumb(`account: password change failed (${describe(e)})`);
    return fail(e);
  }
}

/** Opens the MidManStudio accounts page in the browser. */
export async function openPortal(): Promise<void> {
  try {
    await realDeepLinkBackend()?.openUrl(PORTAL_URL);
  } catch (e) {
    breadcrumb(`account: could not open the portal (${describe(e)})`);
  }
}

export async function signOutNow(): Promise<void> {
  if (!client) return;
  await client.signOut();
  breadcrumb("account: signed out");
}

// ----- Google sign-in: browser out, deep link back

let deepLinksStarted = false;

/** Listens for the link the browser sends back, and checks whether the app was OPENED by one
 *  (Android may have closed the app while the person was in the browser). Never throws. */
async function startDeepLinks(): Promise<void> {
  if (deepLinksStarted) return;
  deepLinksStarted = true;
  const backend = realDeepLinkBackend();
  if (!backend) return;
  try {
    await backend.onUrl((url) => void handleDeepLink(url));
    for (const url of await backend.getCurrent()) await handleDeepLink(url);
  } catch (e) {
    breadcrumb(`account: deep links unavailable (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
  }
}

async function handleDeepLink(url: string): Promise<void> {
  if (!client) return;
  try {
    const session = await client.completeOAuth(url);
    if (!session) return; // not ours, a repeat, or nothing was pending
    account.oauthPending = false;
    account.oauthMessage = null;
    breadcrumb("account: signed in with Google");
    pushToast({ title: "Signed in", description: session.user.email || undefined });
    void enrolSoon();
  } catch (e) {
    account.oauthPending = false;
    account.oauthMessage = friendlyAuthMessage(e);
    breadcrumb(`account: Google sign-in failed (${describe(e)})`);
    pushToast({ title: "Google sign-in", description: friendlyAuthMessage(e) });
  }
}

/** Opens Google sign-in in the browser. The result arrives later through handleDeepLink. */
export async function signInWithGoogle(): Promise<AccountResult> {
  if (!client) return fail(new AuthError("not-configured", "Not ready"));
  const backend = realDeepLinkBackend();
  if (!backend) return fail(new AuthError("oauth-failed", "Google sign-in needs the phone app"));
  try {
    account.oauthMessage = null;
    const url = await client.beginOAuth("google");
    account.oauthPending = true;
    await backend.openUrl(url);
    breadcrumb("account: Google sign-in opened in the browser");
    return { ok: true };
  } catch (e) {
    account.oauthPending = false;
    client.cancelOAuth();
    breadcrumb(`account: Google sign-in could not start (${describe(e)})`);
    return fail(e);
  }
}

/** The person came back without finishing. */
export function cancelGoogle(): void {
  client?.cancelOAuth();
  account.oauthPending = false;
  account.oauthMessage = null;
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
