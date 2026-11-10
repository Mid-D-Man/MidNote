// Opens a web or mail address in the phone's own browser / mail app (never inside the app's window: a link that took
// over the app's WebView would leave nowhere to go back to). Only addresses utils/markdown.ts's safeHref accepts are opened.
import { realDeepLinkBackend } from "$lib/online/deepLink";
import { safeHref } from "$lib/utils/markdown";

declare global {
  // eslint-disable-next-line no-var
  var __midnoteOpenLink: ((url: string) => void) | undefined; // test seam: the smoke harness records the address instead
}

/** true = handed to the phone. */
export async function openExternal(url: string): Promise<boolean> {
  const safe = safeHref(url);
  if (!safe) return false;
  if (globalThis.__midnoteOpenLink) {
    globalThis.__midnoteOpenLink(safe);
    return true;
  }
  try {
    const backend = realDeepLinkBackend();
    if (backend) {
      await backend.openUrl(safe);
      return true;
    }
  } catch {
    /* fall through to the browser route */
  }
  try {
    window.open(safe, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}
