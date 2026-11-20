// Text sent from another app's selection menu. On Android, selecting text in any app shows a menu with actions from installed
// apps; MidNote adds two (src-tauri/android-text-actions): "Read aloud" and "Make a note". The Android side turns the selection
// into a link and opens the app with it:
//     midnote://text/read?id=<once>&t=<the text, percent-encoded>[&cut=1]
//     midnote://text/note?id=<once>&t=<the text, percent-encoded>[&cut=1]
//
// Same rules as the widget's links (utils/widgetLinks.ts): the link itself never creates anything. "note" only shows the text
// for the person to confirm; "read" starts reading it. The id is made fresh for every selection: Android can hand the same link
// over again (the app coming back from recents, a page reload), and an id already used is ignored. The text is DATA: it is cut
// to a limit and never parsed as markup. Plain TypeScript, no DOM beyond localStorage.

export type TextMode = "read" | "note";

export interface TextLink {
  mode: TextMode;
  /** Unique per selection (replay guard). */
  id: string;
  text: string;
  /** The Android side or this reader cut the text to MAX_SELECTION_CHARS. */
  cut: boolean;
}

/**
 * The longest selection taken (characters). The Android side cuts at the same number. It is 30,000 and not more because the link
 * travels inside an Intent (a Binder transaction of about 1 MB, text held as UTF-16): 30,000 characters of Chinese or Japanese
 * become about 270,000 characters of link, which still fits; twice that would not.
 */
export const MAX_SELECTION_CHARS = 30_000;
/** A longer link than this is not one of ours (the largest the Android side can build is about 270,000). */
const MAX_LINK_LENGTH = 300_000;

const TEXT_LINK = /^midnote:\/\/text\/(read|note)\/?\?([^#]*)(?:#.*)?$/i;
const ID_OK = /^[A-Za-z0-9_-]{6,40}$/;
// everything but tab, line feed and printable characters (a selection can carry stray control characters)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Is this link one of the two text links? (Cheap: lets callers skip the rest.) */
export function isTextLink(url: string): boolean {
  return TEXT_LINK.test(url.trim());
}

/** The selection a text link carries, or null when it is not a well-formed text link or carries nothing to use. */
export function parseTextLink(url: string): TextLink | null {
  const u = url.trim();
  if (u.length > MAX_LINK_LENGTH) return null;
  const m = TEXT_LINK.exec(u);
  if (!m) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(m[2]);
  } catch {
    return null;
  }
  const id = params.get("id") ?? "";
  if (!ID_OK.test(id)) return null;
  let text = (params.get("t") ?? "").replace(/\r\n?/g, "\n").replace(CONTROL, "");
  let cut = params.get("cut") === "1";
  const chars = Array.from(text);
  if (chars.length > MAX_SELECTION_CHARS) {
    text = chars.slice(0, MAX_SELECTION_CHARS).join("");
    cut = true;
  }
  if (text.trim() === "") return null;
  return { mode: m[1].toLowerCase() as TextMode, id, text, cut };
}

const SEEN_KEY = "midnote:text-links-seen";
const SEEN_MAX = 30;

/**
 * Remember that this link's id was acted on. Returns false when it already had been (ignore the link), true when it is new.
 * Without storage the answer is true: better to act twice than never.
 */
export function rememberTextLink(id: string): boolean {
  try {
    let seen: string[] = [];
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) seen = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      seen = []; // damaged data counts as empty, and is written over below
    }
    if (seen.includes(id)) return false;
    seen.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX)));
    return true;
  } catch {
    return true; // no usable storage at all
  }
}

/** The link the Android side builds (the Kotlin writes the same shape). Used by tests. */
export function textLink(mode: TextMode, id: string, text: string, cut = false): string {
  return `midnote://text/${mode}?id=${id}&t=${encodeURIComponent(text)}${cut ? "&cut=1" : ""}`;
}
