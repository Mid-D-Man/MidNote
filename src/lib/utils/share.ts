// Wraps navigator.share — the modern, non-deprecated Web Share API
// (unlike execCommand, this one has a real future). Real platform
// uncertainty worth stating plainly rather than glossing over: Tauri
// serves the app from a custom scheme its own tooling treats as a
// secure context, so navigator.share itself should be available, but
// whether this specific Android WebView build supports sharing *files*
// specifically (not just text) depends on OS-level share-intent
// bridging this app doesn't control. Feature-detected and layered with
// fallbacks below rather than assumed — same posture as richText.ts's
// execCommand caveats, and same reason: no real device to check against
// here, so on-device confirmation is still the last word.
import type { ExportedFile } from "$lib/utils/selectionActions";

export type ShareResult = "shared" | "unsupported" | "cancelled" | "error";

export async function shareFiles(files: ExportedFile[], opts: { title?: string; text?: string } = {}): Promise<ShareResult> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return "unsupported";
  }

  try {
    const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || "text/plain" }));
    const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: asFiles });

    if (canShareFiles) {
      await navigator.share({ files: asFiles, title: opts.title, text: opts.text });
      return "shared";
    }

    // File sharing specifically isn't supported here — fall back to a
    // text-only share rather than failing outright. Still genuinely
    // useful, just without attachments.
    if (opts.text) {
      await navigator.share({ title: opts.title, text: opts.text });
      return "shared";
    }

    return "unsupported";
  } catch (err) {
    // The user dismissing the native share sheet throws AbortError —
    // that's a normal, silent outcome, not a real error.
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    console.error("share: navigator.share failed:", err);
    return "error";
  }
}
