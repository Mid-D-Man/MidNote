// Round B — a small Supabase Auth client over plain fetch (no @supabase/supabase-js:
// the project keeps zero new dependencies).
//
// PURE: every outside thing (network, clock, storage) is injected, so the logic runs
// in Node under esbuild with a fake server and the jsdom smoke suite alike.
//
// What it speaks (GoTrue, under <project>/auth/v1):
//   POST signup                       -> user (+ tokens only when email confirmation is OFF)
//   POST token?grant_type=password    -> session
//   POST token?grant_type=refresh_token
//   POST logout?scope=local
//   POST recover / resend
// and, for the rest of the app, request() = any /rest/v1/... call with the user's token.
//
// Headers: the publishable key goes in `apikey` on EVERY call; the user's access token
// goes in `Authorization: Bearer` on user calls only. The key is never a Bearer token
// (the new key format is not a JWT and the gateway rejects it there).
//
// LOCAL-FIRST RULES this file enforces:
//   * Being offline, or the server having a bad moment (5xx, 429), NEVER signs anyone
//     out. Only a server answer that says the session is dead (400/401/403 on refresh)
//     does, and only a refresh that was still current when it started may change it.
//   * Refresh tokens rotate (each works once), so two refreshes at the same moment would
//     kill the session: refresh is single-flight.
//   * Signing out clears the phone first, then tells the server (best effort).
//   * Tokens are never logged and never put in error messages.
import type { OnlineConfig } from "./config";
import { bytesToBase64Url, sha256 } from "./sha256";
import { checkPassword, MIN_PASSWORD_LENGTH } from "./passwordRules";

export { MIN_PASSWORD_LENGTH };

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds on THIS phone's clock (computed from expires_in, so a wrong
   *  phone clock cannot make a fresh token look old on arrival). */
  expiresAt: number;
  user: AuthUser;
}

export type AuthErrorKind =
  | "not-configured"
  | "signed-out"
  | "network"
  | "invalid-credentials"
  | "email-not-confirmed"
  | "weak-password"
  | "invalid-email"
  | "invalid-name"
  | "same-password"
  | "reauth-needed"
  | "user-exists"
  | "oauth-cancelled"
  | "oauth-failed"
  | "signups-disabled"
  | "rate-limited"
  | "server"
  | "unknown";

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly status: number | null;
  constructor(kind: AuthErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "AuthError";
    this.kind = kind;
    this.status = status;
  }
}

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface SessionStore {
  get(): string | null;
  set(value: string): void;
  clear(): void;
}

export interface AuthDeps {
  config: OnlineConfig | null;
  fetch: HttpFetch;
  /** Epoch milliseconds. */
  now: () => number;
  store: SessionStore;
  /** Where a password-reset email sends the person (the accounts portal). Left out: the
   *  project's own Site URL is used. */
  recoverRedirectTo?: string;
  /** Browser sign-in (Google). Left out: beginOAuth/completeOAuth report "not configured". */
  oauth?: OAuthDeps;
}

export interface OAuthDeps {
  /** Where the browser sends the person back to: the app's deep link, e.g. "midnote://auth".
   *  It must be in the project's redirect allow-list EXACTLY as written (no extra query). */
  redirectUri: string;
  /** Holds the pending sign-in's secret while the person is in the browser (survives the app
   *  being closed by Android meanwhile). */
  store: SessionStore;
  randomBytes(n: number): Uint8Array;
}

/** What the browser's trip back to the app carried. */
export interface OAuthCallback {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
}

/** null when the URL isn't our redirect at all. Parameters may sit in the query or the #fragment. */
export function parseOAuthCallback(url: string, redirectUri: string): OAuthCallback | null {
  let u: URL;
  let r: URL;
  try {
    u = new URL(url);
    r = new URL(redirectUri);
  } catch {
    return null;
  }
  if (u.protocol !== r.protocol || u.host.toLowerCase() !== r.host.toLowerCase()) return null;
  const params: Record<string, string> = {};
  if (u.hash.startsWith("#")) {
    try {
      new URLSearchParams(u.hash.slice(1)).forEach((v, k) => {
        params[k] = v;
      });
    } catch {
      /* not a query string */
    }
  }
  u.searchParams.forEach((v, k) => {
    params[k] = v; // the query wins over the fragment
  });
  const error = params.error || (params.error_description || params.error_code ? "error" : null);
  return { code: params.code || null, error: error || null, errorDescription: params.error_description || null };
}

/** Refresh when fewer than this many ms of life are left. */
export const REFRESH_MARGIN_MS = 60_000;
export const MAX_NAME_LENGTH = 80;
/** How long a started Google sign-in stays valid while the person is in the browser. */
export const OAUTH_TTL_MS = 10 * 60_000;

// ---------------------------------------------------------------- pure helpers

export function normalizeEmail(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Turn a failed auth response into one of our kinds. Never includes tokens. */
export function mapAuthError(status: number, bodyText: string): AuthError {
  const body = parseJson(bodyText);
  const code = String(body.error_code ?? body.error ?? "").toLowerCase();
  const msg = String(body.msg ?? body.message ?? body.error_description ?? "");
  const m = msg.toLowerCase();

  if (status === 429 || code.startsWith("over_") || m.includes("rate limit")) return new AuthError("rate-limited", msg || "Too many requests", status);
  if (code === "invalid_credentials" || m.includes("invalid login credentials")) return new AuthError("invalid-credentials", msg || "Invalid login credentials", status);
  if (code === "email_not_confirmed" || m.includes("email not confirmed")) return new AuthError("email-not-confirmed", msg || "Email not confirmed", status);
  if (code === "same_password" || m.includes("different from the old password")) return new AuthError("same-password", msg || "Same password", status);
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid" || m.includes("reauthentication")) return new AuthError("reauth-needed", msg || "Reauthentication needed", status);
  if (code === "weak_password" || (m.includes("password") && (m.includes("should be at least") || m.includes("too short") || m.includes("weak")))) return new AuthError("weak-password", msg || "Weak password", status);
  if (code === "user_already_exists" || code === "email_exists" || m.includes("already registered")) return new AuthError("user-exists", msg || "User already registered", status);
  if (code === "signup_disabled" || m.includes("signups not allowed") || m.includes("signup is disabled")) return new AuthError("signups-disabled", msg || "Signups disabled", status);
  if (code === "validation_failed" || code === "email_address_invalid" || m.includes("unable to validate email") || m.includes("invalid format")) return new AuthError("invalid-email", msg || "Invalid email", status);
  if (status >= 500) return new AuthError("server", msg || "Server error", status);
  return new AuthError("unknown", msg || `Request failed (${status})`, status);
}

/** Read a token response. Throws AuthError('unknown') if it isn't one. */
export function parseSession(body: Record<string, unknown>, now: number): AuthSession {
  const access = body.access_token;
  const refresh = body.refresh_token;
  const user = body.user && typeof body.user === "object" ? (body.user as Record<string, unknown>) : null;
  if (typeof access !== "string" || !access || typeof refresh !== "string" || !refresh || !user || typeof user.id !== "string" || !user.id) {
    throw new AuthError("unknown", "The server's reply wasn't a valid session");
  }
  const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? body.expires_in : null;
  const expiresAtSec = typeof body.expires_at === "number" && Number.isFinite(body.expires_at) ? body.expires_at : null;
  const expiresAt = expiresIn !== null ? now + expiresIn * 1000 : expiresAtSec !== null ? expiresAtSec * 1000 : now + 3_600_000;
  return { accessToken: access, refreshToken: refresh, expiresAt, user: { id: user.id, email: typeof user.email === "string" ? user.email : "" } };
}

/** Read what we stored; anything that isn't a whole session is discarded. */
export function readStoredSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AuthSession> | null;
    if (
      v &&
      typeof v.accessToken === "string" && v.accessToken &&
      typeof v.refreshToken === "string" && v.refreshToken &&
      typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt) &&
      v.user && typeof v.user.id === "string" && v.user.id && typeof v.user.email === "string"
    ) {
      return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt, user: { id: v.user.id, email: v.user.email } };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// -------------------------------------------------------------------- the client

export class AuthClient {
  private session: AuthSession | null;
  private refreshing: Promise<AuthSession> | null = null;
  /** Bumped whenever the session is replaced or ended by anything other than a refresh, so
   *  a refresh that was already in flight can tell its result is no longer wanted. */
  private generation = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly deps: AuthDeps) {
    let raw: string | null = null;
    try {
      raw = deps.store.get();
    } catch {
      raw = null;
    }
    this.session = readStoredSession(raw);
    if (raw && !this.session) this.clearStore();
  }

  get configured(): boolean {
    return this.deps.config !== null;
  }

  current(): AuthSession | null {
    return this.session;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ----- sign up / in / out

  async signIn(emailRaw: string, password: string): Promise<AuthSession> {
    const email = normalizeEmail(emailRaw);
    if (!looksLikeEmail(email)) throw new AuthError("invalid-email", "Invalid email");
    if (!password) throw new AuthError("invalid-credentials", "Missing password");
    const res = await this.authCall("token?grant_type=password", { email, password });
    const session = parseSession(res, this.deps.now());
    this.setSession(session);
    return session;
  }

  /** `session` is null when the project requires email confirmation (it does). Also null,
   *  deliberately indistinguishable, when the email already has an account.
   *  The name goes in as `display_name` user metadata, exactly like the accounts portal's own
   *  sign-up: the shared project's profile is built from it. */
  async signUp(emailRaw: string, password: string, displayNameRaw: string): Promise<{ session: AuthSession | null }> {
    const email = normalizeEmail(emailRaw);
    const displayName = String(displayNameRaw ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (!displayName) throw new AuthError("invalid-name", "Missing name");
    if (!looksLikeEmail(email)) throw new AuthError("invalid-email", "Invalid email");
    if (!checkPassword(password).ok) throw new AuthError("weak-password", "Password doesn't meet the rules");
    const res = await this.authCall("signup", { email, password, data: { display_name: displayName } });
    if (typeof res.access_token === "string" && res.access_token) {
      const session = parseSession(res, this.deps.now());
      this.setSession(session);
      return { session };
    }
    return { session: null };
  }

  async resendConfirmation(emailRaw: string): Promise<void> {
    const email = normalizeEmail(emailRaw);
    if (!looksLikeEmail(email)) throw new AuthError("invalid-email", "Invalid email");
    await this.authCall("resend", { type: "signup", email });
  }

  async recoverPassword(emailRaw: string): Promise<void> {
    const email = normalizeEmail(emailRaw);
    if (!looksLikeEmail(email)) throw new AuthError("invalid-email", "Invalid email");
    const to = this.deps.recoverRedirectTo;
    await this.authCall(to ? `recover?redirect_to=${encodeURIComponent(to)}` : "recover", { email });
  }

  /** Sets or changes the password of the signed-in person. No email is involved: it is the
   *  signed-in user updating their own account (PUT /auth/v1/user). This also gives a Google
   *  account a password, so email + password sign-in works for it too. */
  async updatePassword(password: string): Promise<void> {
    if (!checkPassword(password).ok) throw new AuthError("weak-password", "Password doesn't meet the rules");
    const res = await this.request("auth/v1/user", { method: "PUT", body: JSON.stringify({ password }) });
    if (res.status >= 200 && res.status < 300) return;
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* no body */
    }
    throw mapAuthError(res.status, text);
  }

  /** Local sign-out is immediate and cannot fail; telling the server is best effort. */
  async signOut(): Promise<void> {
    const old = this.session;
    this.setSession(null);
    if (!old || !this.deps.config) return;
    try {
      await this.deps.fetch(`${this.deps.config.url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: this.deps.config.key, Authorization: `Bearer ${old.accessToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      /* the phone is signed out either way */
    }
  }

  // ----- sign in with Google (browser + deep link + PKCE)

  private pendingOAuth: { verifier: string; at: number } | null = null;
  /** Starts a sign-in: returns the URL to open in the browser. Remembers the PKCE secret. */
  async beginOAuth(provider: "google"): Promise<string> {
    const cfg = this.deps.config;
    const o = this.deps.oauth;
    if (!cfg || !o) throw new AuthError("not-configured", "Online features aren't set up");
    const verifier = bytesToBase64Url(o.randomBytes(48)); // 64 chars of the unreserved set
    const challenge = bytesToBase64Url(sha256(new TextEncoder().encode(verifier)));
    this.pendingOAuth = { verifier, at: this.deps.now() };
    try {
      o.store.set(JSON.stringify(this.pendingOAuth));
    } catch {
      /* the in-memory copy still works while the app stays open */
    }
    return (
      `${cfg.url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}` +
      `&redirect_to=${encodeURIComponent(o.redirectUri)}` +
      `&code_challenge=${challenge}&code_challenge_method=s256`
    );
  }

  /** Gives up on a started sign-in (the person came back without finishing). */
  cancelOAuth(): void {
    this.takePendingOAuth();
  }

  /** Handles a link the app was opened with. Returns the session when it was ours and worked,
   *  null when it wasn't ours / was a repeat / there was nothing pending, and throws
   *  AuthError when the sign-in failed or was cancelled in the browser. */
  async completeOAuth(url: string): Promise<AuthSession | null> {
    const o = this.deps.oauth;
    if (!o || !this.deps.config) return null;
    const cb = parseOAuthCallback(url, o.redirectUri);
    if (!cb) return null;
    if (cb.error) {
      this.takePendingOAuth();
      const cancelled = cb.error === "access_denied";
      throw new AuthError(cancelled ? "oauth-cancelled" : "oauth-failed", cb.errorDescription || cb.error);
    }
    if (!cb.code) return null;
    // The pending secret is taken (and so used up) BEFORE the network call, which is also what
    // makes a link Android delivers twice (cold start + event) harmless: the repeat finds
    // nothing pending and is ignored.
    const pending = this.takePendingOAuth();
    if (!pending) return null;
    if (this.deps.now() - pending.at > OAUTH_TTL_MS) throw new AuthError("oauth-failed", "The sign-in took too long");
    let body: Record<string, unknown>;
    try {
      body = await this.authCall("token?grant_type=pkce", { auth_code: cb.code, code_verifier: pending.verifier });
    } catch (e) {
      if (e instanceof AuthError && !["network", "rate-limited", "server", "not-configured"].includes(e.kind)) {
        throw new AuthError("oauth-failed", e.message, e.status);
      }
      throw e;
    }
    const session = parseSession(body, this.deps.now());
    this.setSession(session);
    return session;
  }

  private takePendingOAuth(): { verifier: string; at: number } | null {
    let pending = this.pendingOAuth;
    this.pendingOAuth = null;
    const o = this.deps.oauth;
    if (o) {
      if (!pending) {
        try {
          const raw = o.store.get();
          const v = raw ? (JSON.parse(raw) as { verifier?: unknown; at?: unknown }) : null;
          if (v && typeof v.verifier === "string" && v.verifier && typeof v.at === "number") pending = { verifier: v.verifier, at: v.at };
        } catch {
          pending = null;
        }
      }
      try {
        o.store.clear();
      } catch {
        /* ignore */
      }
    }
    return pending;
  }

  // ----- tokens

  /** A usable access token, refreshing first if it is about to expire. */
  async accessToken(): Promise<string> {
    const s = this.session;
    if (!s) throw new AuthError("signed-out", "Not signed in");
    if (s.expiresAt - this.deps.now() > REFRESH_MARGIN_MS) return s.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** Single-flight refresh. */
  refresh(): Promise<AuthSession> {
    if (this.refreshing) return this.refreshing;
    const started = this.session;
    if (!started) return Promise.reject(new AuthError("signed-out", "Not signed in"));
    if (!this.deps.config) return Promise.reject(new AuthError("not-configured", "Online features aren't set up"));
    const cfg = this.deps.config;
    const gen = this.generation;
    const p = (async () => {
      let res: HttpResponse;
      let text: string;
      try {
        res = await this.deps.fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { apikey: cfg.key, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: started.refreshToken }),
        });
        text = await res.text();
      } catch {
        throw new AuthError("network", "Can't reach the server");
      }
      if (res.status >= 200 && res.status < 300) {
        const next = parseSession(parseJson(text), this.deps.now());
        // Signed out (or into another account) while this was in flight: drop the result.
        if (gen !== this.generation) throw new AuthError("signed-out", "Not signed in");
        this.setSession(next, true);
        return next;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        if (gen === this.generation) this.setSession(null);
        throw new AuthError("signed-out", "The session has ended", res.status);
      }
      throw mapAuthError(res.status, text);
    })().finally(() => {
      this.refreshing = null;
    });
    this.refreshing = p;
    return p;
  }

  /** Call any <project>/<path> (e.g. "rest/v1/...") as the signed-in user. Retries ONCE on 401
   *  with a fresh token. Throws AuthError for signed-out / network; HTTP errors come back
   *  as the response for the caller to read. */
  async request(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<HttpResponse> {
    const cfg = this.deps.config;
    if (!cfg) throw new AuthError("not-configured", "Online features aren't set up");
    const used = await this.accessToken();
    let res = await this.send(cfg, path, init, used);
    if (res.status === 401) {
      const cur = this.session;
      if (!cur) throw new AuthError("signed-out", "Not signed in");
      // Someone else already refreshed while we were waiting: use that token. Otherwise refresh.
      const token = cur.accessToken !== used ? cur.accessToken : (await this.refresh()).accessToken;
      res = await this.send(cfg, path, init, token);
    }
    return res;
  }

  // ----- internals

  private async send(cfg: OnlineConfig, path: string, init: { method?: string; headers?: Record<string, string>; body?: string }, token: string): Promise<HttpResponse> {
    try {
      return await this.deps.fetch(`${cfg.url}/${path.replace(/^\/+/, "")}`, {
        method: init.method ?? "GET",
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}), apikey: cfg.key, Authorization: `Bearer ${token}` },
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    } catch {
      throw new AuthError("network", "Can't reach the server");
    }
  }

  /** A call to /auth/v1/<path> with only the apikey. Returns the parsed JSON body or throws. */
  private async authCall(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cfg = this.deps.config;
    if (!cfg) throw new AuthError("not-configured", "Online features aren't set up");
    let res: HttpResponse;
    let text: string;
    try {
      res = await this.deps.fetch(`${cfg.url}/auth/v1/${path}`, {
        method: "POST",
        headers: { apikey: cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      text = await res.text();
    } catch {
      throw new AuthError("network", "Can't reach the server");
    }
    if (res.status < 200 || res.status >= 300) throw mapAuthError(res.status, text);
    return parseJson(text);
  }

  /** `fromRefresh`: the same session's tokens rotating. Every OTHER change (sign in, sign
   *  up, sign out, the server ending the session) bumps `generation`, which is how a refresh
   *  that started earlier knows its result is no longer wanted. */
  private setSession(next: AuthSession | null, fromRefresh = false): void {
    this.session = next;
    if (!fromRefresh) this.generation++;
    try {
      if (next) this.deps.store.set(JSON.stringify(next));
      else this.deps.store.clear();
    } catch {
      /* storage full or blocked: the in-memory session still works until restart */
    }
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* a listener's bug must not break auth */
      }
    }
  }

  private clearStore(): void {
    try {
      this.deps.store.clear();
    } catch {
      /* ignore */
    }
  }
}

/** The real network call, with a timeout so a dead connection can't leave a spinner forever. */
export function realHttpFetch(timeoutMs = 20_000): HttpFetch {
  return async (url, init) => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      return await fetch(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
