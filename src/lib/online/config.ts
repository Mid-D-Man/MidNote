// Round B — where the online side finds its Supabase address and key.
//
// Both values are PUBLIC by design: the project URL and the *publishable* key
// (sb_publishable_...) end up inside the APK, exactly like a website's. They are
// injected at build time by build-andriod.yml from the GitHub secrets
// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY as VITE_SUPABASE_URL /
// VITE_SUPABASE_PUBLISHABLE_KEY. What protects the data is Row Level Security in
// the database (midnote-001-entries.sql), never the key.
//
// The one mistake that would matter is pasting the SECRET key (sb_secret_...,
// or the legacy service_role JWT) into the publishable slot: it would be baked
// into every APK and bypass RLS for anyone who unpacks one. This file refuses to
// run with such a key (the workflow refuses to build with one, too).
//
// No browser atob(): the jsdom smoke environment mis-handles it (see the handover's
// harness notes), so the tiny base64url reader below is hand-written.
export interface OnlineConfig {
  /** https://<project>.supabase.co  (no trailing slash) */
  url: string;
  /** Publishable key — goes in the `apikey` header ONLY, never as a Bearer token. */
  key: string;
}

/** The MidManStudio accounts portal (mms-accounts, on Cloudflare Pages). Password-reset emails
 *  send people back to it, exactly as the portal's own "forgot password" does: it handles the
 *  recovery link and lets them choose a new password. It is already on the project's redirect
 *  allow-list (the portal itself uses it). */
export const PORTAL_URL = "https://mms-accounts.pages.dev";

/** Email-dependent flows (create an account by email, forgot password, resend confirmation) only
 *  work when the project can actually SEND mail to any address, which needs a custom SMTP
 *  sender (the built-in one only reaches the project's own team). Until then they are hidden
 *  instead of showing "check your email" for a mail that never comes. Turn them on by setting
 *  the GitHub secret EMAIL_FLOWS to "on" (the build passes it as VITE_EMAIL_FLOWS). */
export function emailFlowsEnabled(): boolean {
  const seam = globalThis.__midnoteOnline;
  if (seam && "emailFlows" in seam) return seam.emailFlows === true;
  return parseEmailFlows(import.meta.env.VITE_EMAIL_FLOWS);
}

/** Only the word "on" (any case, spaces ignored) switches them on; anything else, including
 *  "true" or "yes", leaves them off, so a typo can never half-enable a flow that can't work. */
export function parseEmailFlows(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().toLowerCase() === "on";
}

/** The AI proxy (the Cloudflare Worker in workers/midnote-ai). Its address is PUBLIC, like the Supabase
 *  URL: the build reads it from the GitHub secret AI_PROXY_URL as VITE_AI_PROXY_URL. Returns the address
 *  without a trailing slash, or null when it is missing or not a plain https address. A wrong address can
 *  only make AI fail; it can't leak anything, because the app sends the signed-in person's own token and
 *  nothing else to it. */
export function resolveAiProxyUrl(raw: unknown): string | null {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) return null;
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s?#@]*)?$/.test(url)) return null;
  return url.replace(/\/+$/, "");
}

export function getAiProxyUrl(): string | null {
  const seam = globalThis.__midnoteOnline;
  if (seam && "aiUrl" in seam) return resolveAiProxyUrl(seam.aiUrl);
  return resolveAiProxyUrl(import.meta.env.VITE_AI_PROXY_URL);
}

export type ConfigProblem = "missing" | "bad-url" | "bad-key" | "secret-key";

export type ConfigResult = { ok: true; config: OnlineConfig } | { ok: false; problem: ConfigProblem };

declare global {
  // Test seam only (the jsdom smoke test has no network and no real project).
  // eslint-disable-next-line no-var
  var __midnoteOnline:
    | {
        config?: OnlineConfig | null;
        emailFlows?: boolean;
        /** The AI proxy address (null = this build has none). */
        aiUrl?: string | null;
        fetch?: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
        now?: () => number;
      }
    | undefined;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Decode a base64url string to text (ASCII/UTF-8 enough for a JWT payload). Returns "" if malformed. */
export function base64UrlToText(input: string): string {
  const s = input.replace(/=+$/, "");
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v === -1) return "";
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}

/** A legacy Supabase key is a JWT; the service_role one is the secret one. */
export function isLegacyServiceRoleKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  const payload = base64UrlToText(parts[1]);
  return /"role"\s*:\s*"service_role"/.test(payload);
}

export function resolveOnlineConfig(rawUrl: unknown, rawKey: unknown): ConfigResult {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!url && !key) return { ok: false, problem: "missing" };
  if (!url || !key) return { ok: false, problem: "missing" };
  if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url)) return { ok: false, problem: "bad-url" };
  if (/\s/.test(key)) return { ok: false, problem: "bad-key" };
  if (key.startsWith("sb_secret_") || isLegacyServiceRoleKey(key)) return { ok: false, problem: "secret-key" };
  return { ok: true, config: { url: url.replace(/\/+$/, ""), key } };
}

let cached: ConfigResult | null = null;

/** The build's config (or the test seam's). Never throws. */
export function getOnlineConfig(): ConfigResult {
  const seam = globalThis.__midnoteOnline;
  if (seam && "config" in seam) {
    return seam.config ? resolveOnlineConfig(seam.config.url, seam.config.key) : { ok: false, problem: "missing" };
  }
  if (!cached) cached = resolveOnlineConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  return cached;
}
