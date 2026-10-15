// Round B2 — the two native things Google sign-in needs, behind one small interface so the
// jsdom smoke test can stand in for them:
//
//   openUrl(url)   open the sign-in page in the phone's browser.
//                  tauri-plugin-opener (already in the app): on Android it fires an
//                  ACTION_VIEW intent for the URL (source read at 2.7.2). Allowed by the
//                  `opener:default` permission, whose scope includes https://*.
//   getCurrent()   the link that opened the app, if it was opened by one.
//   onUrl(cb)      links that arrive while the app is running.
//                  tauri-plugin-deep-link 2.6.1 (source read): the Kotlin plugin matches
//                  incoming VIEW intents against the scheme/host in tauri.conf.json
//                  (midnote://auth), stores the last one for get_current, and sends the
//                  `deep-link://new-url` event, payload = [url].
//
// Called with plain invoke()/listen() from @tauri-apps/api (already a dependency), the same
// way the reminder, share and read-aloud plugins are: no new npm package.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface DeepLinkBackend {
  openUrl(url: string): Promise<void>;
  getCurrent(): Promise<string[]>;
  onUrl(cb: (url: string) => void): Promise<() => void>;
}

declare global {
  // Test seam only (the jsdom smoke test has no browser or Android).
  // eslint-disable-next-line no-var
  var __midnoteDeepLink: DeepLinkBackend | undefined;
}

/** The app's own address for the browser to come back to. Must match tauri.conf.json's
 *  plugins.deep-link.mobile entry (scheme "midnote", host "auth") and be added to the Supabase
 *  project's Redirect URLs exactly as written. */
export const OAUTH_REDIRECT_URI = "midnote://auth";

export function realDeepLinkBackend(): DeepLinkBackend | null {
  if (globalThis.__midnoteDeepLink) return globalThis.__midnoteDeepLink;
  if (!isTauri()) return null;
  return {
    openUrl: async (url) => {
      await invoke("plugin:opener|open_url", { url });
    },
    getCurrent: async () => {
      try {
        const v = await invoke<string[] | null>("plugin:deep-link|get_current");
        return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : [];
      } catch {
        return []; // not registered (desktop), or nothing pending
      }
    },
    onUrl: async (cb) => {
      return await listen<(string | null)[]>("deep-link://new-url", (e) => {
        for (const u of e.payload ?? []) if (typeof u === "string") cb(u);
      });
    },
  };
}
