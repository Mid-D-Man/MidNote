// Round 44 — "Copy content" from a card's ⋮ menu and from the multi-select bar:
// the entry's text (title + content, the same plain text Share and the editor's
// own "Copy contents" use) goes onto the clipboard.
//
// navigator.clipboard is tried first; if the WebView refuses it (it needs a
// secure context and a user gesture) the old hidden-textarea + execCommand("copy")
// route is the fallback. Plain TypeScript with the browser parts injected, so it
// runs in Node tests; `globalThis.__midnoteCopyDeps` is the jsdom smoke test's seam.
import type { Entry } from "$lib/types/entry";
import { entryToPlainText } from "$lib/utils/selectionActions";
import { entriesToShareText } from "$lib/utils/share";

export interface CopyDeps {
  clipboard: ((text: string) => Promise<void>) | null;
  /** The old execCommand route; returns whether the browser reported success. */
  legacy: ((text: string) => boolean) | null;
}

declare global {
  // Test seam only: replaces the real deps.
  // eslint-disable-next-line no-var
  var __midnoteCopyDeps: CopyDeps | undefined;
}

export function realCopyDeps(): CopyDeps {
  if (globalThis.__midnoteCopyDeps) return globalThis.__midnoteCopyDeps;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    clipboard: nav?.clipboard && typeof nav.clipboard.writeText === "function" ? (text) => nav.clipboard.writeText(text) : null,
    legacy:
      typeof document === "undefined" || typeof document.execCommand !== "function"
        ? null
        : (text) => {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
            document.body.appendChild(ta);
            ta.select();
            try {
              return document.execCommand("copy");
            } finally {
              ta.remove();
            }
          },
  };
}

/** Puts `text` on the clipboard. false = no route worked. Never throws. */
export async function copyText(text: string, deps: CopyDeps = realCopyDeps()): Promise<boolean> {
  if (deps.clipboard) {
    try {
      await deps.clipboard(text);
      return true;
    } catch {
      /* fall through to the old route */
    }
  }
  if (deps.legacy) {
    try {
      if (deps.legacy(text)) return true;
    } catch {
      /* nothing else to try */
    }
  }
  return false;
}

export type CopyToast = { title: string; description?: string; variant?: "destructive" };

function noun(entry: Entry): string {
  return entry.type === "regular" ? "note" : entry.type;
}

/** Copy one entry's content. Returns the toast to show. A locked entry has no readable content, so it is refused. */
export async function copyEntryContent(entry: Entry, deps?: CopyDeps): Promise<CopyToast> {
  if (entry.encrypted) {
    return { title: "Unlock first", description: `Unlock this ${noun(entry)} before copying its content.`, variant: "destructive" };
  }
  const ok = await copyText(entryToPlainText(entry), deps);
  return ok
    ? { title: "Copied", description: `This ${noun(entry)}'s content is on your clipboard.` }
    : { title: "Couldn't copy", description: "Clipboard access isn't available right now.", variant: "destructive" };
}

/** Copy several entries' content as one text (locked ones are skipped). `copied` = how many went on the clipboard. */
export async function copyEntriesContent(entries: Entry[], deps?: CopyDeps): Promise<{ toast: CopyToast; copied: number }> {
  const { text, skippedLocked } = entriesToShareText(entries);
  const copied = entries.length - skippedLocked;
  if (copied === 0) {
    return { toast: { title: "Nothing to copy", description: "The selected items are locked. Unlock them first.", variant: "destructive" }, copied: 0 };
  }
  const ok = await copyText(text, deps);
  if (!ok) return { toast: { title: "Couldn't copy", description: "Clipboard access isn't available right now.", variant: "destructive" }, copied: 0 };
  const what = entries.every((e) => e.type === entries[0].type) ? `${noun(entries[0])}${copied === 1 ? "" : "s"}` : copied === 1 ? "item" : "items";
  return {
    toast: {
      title: "Copied",
      description: `${copied} ${what} on your clipboard${skippedLocked > 0 ? ` (${skippedLocked} locked skipped)` : ""}.`,
    },
    copied,
  };
}
