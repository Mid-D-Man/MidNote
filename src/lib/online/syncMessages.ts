// Round C — the words sync uses with the person. Pure, so they can be tested.
import type { SyncFailKind, SyncResult } from "$lib/online/syncEngine";

export function friendlyFail(kind: SyncFailKind | "stopped", message = ""): string {
  switch (kind) {
    case "network":
      return "Can't reach the server. Your notes are safe on this phone, and MidNote will try again.";
    case "auth":
    case "stopped":
      return "You're signed out. Sign in again to sync.";
    case "rate-limited":
      return "The server asked for a pause. MidNote will try again in a moment.";
    case "quota":
      return "Your cloud storage is full, so nothing more can be sent.";
    case "rejected":
      return "The server refused some of your notes.";
    case "server":
    default:
      return message && message.length <= 120 ? `The server had a problem: ${message}` : "The server had a problem. MidNote will try again.";
  }
}

export interface Described {
  title: string;
  description: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What to tell the person about a finished run. */
export function describeResult(r: SyncResult): Described {
  if (r.status === "account-mismatch") {
    return { title: "Different account", description: "This phone's notes were synced with another account. Open Settings → Account to choose what to do." };
  }
  if (r.status === "failed") {
    return { title: "Couldn't sync", description: friendlyFail(r.error?.kind ?? "server", r.error?.message ?? "") };
  }
  const sent = r.pushed + r.pushedPurges;
  const got = r.pulled + r.removed;
  const problems: string[] = [];
  if (r.quota) problems.push("Your cloud storage is full, so some changes weren't sent.");
  const tooBig = r.rejected.filter((x) => x.reason === "too-big").length;
  const other = r.rejected.length - tooBig;
  if (tooBig) problems.push(`${plural(tooBig, "item is", "items are")} too big to sync (over 1 MB).`);
  if (other) problems.push(`${plural(other, "item couldn't", "items couldn't")} be sent.`);
  if (r.heldBack) problems.push("Some items were saved by a newer version of MidNote. Update the app to get them.");
  if (r.skipped) problems.push(`${plural(r.skipped, "item on the server", "items on the server")} couldn't be read.`);
  if (r.status === "partial") {
    const done = sent + got > 0 ? ` Sent ${sent}, received ${got}.` : "";
    return { title: "Synced, with problems", description: `${problems.join(" ")}${done}`.trim() };
  }
  if (sent + got === 0) return { title: "Up to date", description: "Everything is already in sync." };
  const parts: string[] = [];
  if (sent) parts.push(`sent ${plural(sent, "change", "changes")}`);
  if (got) parts.push(`received ${plural(got, "change", "changes")}`);
  const text = parts.join(", ");
  return { title: "Synced", description: text.charAt(0).toUpperCase() + text.slice(1) + "." };
}

/** "just now", "5 min ago", "2 h ago", or the date. */
export function formatWhen(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
