// Sharing a note / todo / board / selection as TEXT through the phone's own
// share sheet (WhatsApp, Messages, Gmail, Keep ...).
//
// WHY THIS REPLACED navigator.share: the previous version called the browser's
// Web Share API. That API is implemented by the Chrome app, not by the Android
// System WebView that Tauri runs in, so on the phone `navigator.share` simply
// doesn't exist — every Share tap fell through to "Sharing isn't available
// here" (and the todo's Share was a "coming soon" toast). Sharing from a WebView
// needs native code, so this goes through tauri-plugin-sharekit, whose Android
// side starts a standard ACTION_SEND chooser (read from its source, v0.3.1).
// It is called with plain invoke() — no JS package — like the reminders plugin.
//
// What is shared is the entry as plain text (title + content). A file
// attachment (PDF/Word) would need a FileProvider-backed temp file; Export as…
// already saves those, so Share stays text.
//
// ONE PLATFORM QUIRK this file is built around: Android's chooser reports
// RESULT_CANCELED to the caller even when you DID pick an app and send, so the
// plugin rejects with "Share cancelled" in both cases and JS can't tell them
// apart. That outcome is therefore silent — no "Shared" toast (it might be a
// lie) and no error (it might be a success).
//
// Fallbacks, in order: the native sheet -> the browser's Web Share API (dev in
// a normal browser) -> copy to the clipboard (a toast says so) -> "unsupported".
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Entry } from "$lib/types/entry";
import { entryToPlainText } from "$lib/utils/selectionActions";

export type ShareResult = "shared" | "copied" | "cancelled" | "toolarge" | "unsupported";

/**
 * Android hands the text to the chooser in an Intent, and a Binder transaction
 * is capped around 1 MB for the whole app. 150k characters (up to ~600 KB as
 * UTF-8) leaves a wide margin; past it the caller is told to use Export.
 */
export const MAX_SHARE_CHARS = 150_000;

export interface ShareDeps {
  native: ((text: string) => Promise<void>) | null;
  web: ((data: { title?: string; text: string }) => Promise<void>) | null;
  clipboard: ((text: string) => Promise<void>) | null;
}

declare global {
  // Test seam only (the jsdom smoke test has no Android): replaces the real deps.
  // eslint-disable-next-line no-var
  var __midnoteShareDeps: ShareDeps | undefined;
}

export function realShareDeps(): ShareDeps {
  if (globalThis.__midnoteShareDeps) return globalThis.__midnoteShareDeps;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    native: isTauri()
      ? async (text) => {
          await invoke("plugin:sharekit|share_text", { text, mimeType: "text/plain" });
        }
      : null,
    web: nav && typeof nav.share === "function" ? (data) => nav.share(data) : null,
    clipboard: nav?.clipboard && typeof nav.clipboard.writeText === "function" ? (text) => nav.clipboard.writeText(text) : null,
  };
}

function isCancel(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

export async function shareText(
  text: string,
  opts: { title?: string; log?: (msg: string) => void } = {},
  deps: ShareDeps = realShareDeps(),
): Promise<ShareResult> {
  const log = opts.log ?? (() => {});
  if (text.length > MAX_SHARE_CHARS) return "toolarge";

  if (deps.native) {
    try {
      await deps.native(text);
      return "shared";
    } catch (err) {
      if (isCancel(err)) return "cancelled";
      log(`share: native sheet failed (${err instanceof Error ? err.message : String(err)})`);
    }
  } else if (deps.web) {
    try {
      await deps.web({ title: opts.title, text });
      return "shared";
    } catch (err) {
      if (isCancel(err)) return "cancelled";
      log(`share: web share failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  if (deps.clipboard) {
    try {
      await deps.clipboard(text);
      return "copied";
    } catch (err) {
      log(`share: clipboard failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return "unsupported";
}

/** The toast for an outcome, or null when saying nothing is right ("shared" / "cancelled"). */
export function shareOutcomeToast(result: ShareResult): { title: string; description?: string; variant?: "destructive" } | null {
  switch (result) {
    case "copied":
      return { title: "Copied to clipboard", description: "Sharing isn't available here, so the text was copied instead." };
    case "toolarge":
      return { title: "Too long to share as text", description: "Use Export as… to save it as a file instead.", variant: "destructive" };
    case "unsupported":
      return { title: "Couldn't share", description: "Try Export instead.", variant: "destructive" };
    default:
      return null;
  }
}

/** One share-able text for several entries; locked ones are skipped (their content is cleared while locked). */
export function entriesToShareText(entries: Entry[]): { text: string; skippedLocked: number } {
  const open = entries.filter((e) => !e.encrypted);
  return {
    text: open.map(entryToPlainText).join("\n\n----------\n\n"),
    skippedLocked: entries.length - open.length,
  };
}
