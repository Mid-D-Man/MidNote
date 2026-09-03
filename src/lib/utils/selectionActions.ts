// What multi-select's action bar (Delete/Send/Merge/Export) actually
// does with a set of selected entries. Kept as plain functions, not
// component-bound logic, so they're independently testable and reusable
// between Export and Send (Send shares the exact same generated files
// through navigator.share instead of downloading them — see share.ts).
//
// A note on "merge" specifically: this is plain TypeScript, not DixScript.
// MdixMerger (the real merge engine — see themes.mdix/custom-themes.mdix
// for where DixScript is actually used in this project) merges
// *structured* fields across .mdix documents — scalars via a priority
// strategy, arrays via concat+dedup. Two notes' body text isn't
// structured data with a field-level conflict to resolve, and the app's
// entries don't go through DixScript at runtime at all yet (still
// localStorage — see storage.ts and entries.svelte.ts's header
// comments), so there's no live engine to hand this to regardless. What
// follows is hand-written, but the tags/categories merging deliberately
// mirrors concat_dedup's actual behavior (union, no duplicates) since
// that part of the idea genuinely does carry over.
import { zipSync, strToU8 } from "fflate";
import { writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { createNote, createTodo, generateId } from "$lib/storage";
import { htmlToPlainText } from "$lib/utils/richText";
import type { Entry, Note, Todo } from "$lib/types/entry";

export function entryToPlainText(entry: Entry): string {
  if (entry.type === "regular") {
    return `${entry.title || "Untitled"}\n\n${htmlToPlainText(entry.content)}`;
  }
  const lines: string[] = [entry.title || "Untitled", ""];
  for (const step of entry.steps) {
    lines.push(`[${step.category}] ${step.title}`);
    if (step.content) lines.push(step.content);
    lines.push("");
  }
  if (entry.annotations.length > 0) {
    lines.push("--- Notes ---");
    for (const a of entry.annotations) {
      lines.push(a.content ? `${a.title}: ${a.content}` : a.title);
    }
  }
  return lines.join("\n").trim();
}

export function safeFileName(title: string, fallback: string): string {
  const base = (title || fallback).trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
  return base || fallback;
}

function dedupeFileNames(files: { name: string; text: string }[]): { name: string; text: string }[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const count = seen.get(f.name) ?? 0;
    seen.set(f.name, count + 1);
    return count === 0 ? f : { ...f, name: f.name.replace(/\.txt$/, ` (${count}).txt`) };
  });
}

// --- Merge ---
// Same-type only (notes with notes, todos with todos) — merging a
// todo's steps into a note's prose, or vice versa, doesn't have an
// obvious "right" behavior, so the caller is expected to only offer
// this when the whole selection is one type.

export function mergeNotes(selected: Note[]): Note {
  const merged = createNote();
  merged.title = selected.map((n) => n.title || "Untitled").join(" + ");
  merged.content = selected.map((n) => n.content).join("<hr>");
  merged.tags = dedupeStrings(selected.flatMap((n) => n.tags));
  merged.isBookmarked = selected.some((n) => n.isBookmarked);
  return merged;
}

export function mergeTodos(selected: Todo[]): Todo {
  const merged = createTodo();
  merged.title = selected.map((t) => t.title || "Untitled").join(" + ");
  merged.categories = dedupeStrings(selected.flatMap((t) => t.categories));
  merged.tags = dedupeStrings(selected.flatMap((t) => t.tags));
  // Fresh ids on every merged step/annotation — the sources could each
  // independently contain e.g. an id "s1", and blindly concatenating
  // would risk a collision no single source ever had a chance to see.
  merged.steps = selected.flatMap((t) => t.steps.map((s) => ({ ...s, id: generateId() })));
  merged.annotations = selected.flatMap((t) => t.annotations.map((a) => ({ ...a, id: generateId() })));
  merged.isBookmarked = selected.some((t) => t.isBookmarked);
  return merged;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

// --- Export / Send ---
// Both produce the same files — Export downloads them, Send hands them
// to navigator.share (see share.ts). Kept as one function so the two
// actions can never quietly drift into generating different content.

export type ExportFormat = "separate" | "combined" | "zip";

export interface ExportedFile {
  name: string;
  blob: Blob;
}

export function buildExportFiles(entries: Entry[], format: ExportFormat): ExportedFile[] {
  const named = dedupeFileNames(
    entries.map((e, i) => ({
      name: `${safeFileName(e.title, `entry-${i + 1}`)}.txt`,
      text: entryToPlainText(e),
    })),
  );

  if (format === "combined") {
    const divider = `\n\n${"=".repeat(40)}\n\n`;
    const combined = named.map((f) => f.text).join(divider);
    return [{ name: "MidNote-export.txt", blob: new Blob([combined], { type: "text/plain" }) }];
  }

  if (format === "separate") {
    return named.map((f) => ({ name: f.name, blob: new Blob([f.text], { type: "text/plain" }) }));
  }

  // zip
  const zipInput: Record<string, Uint8Array> = {};
  named.forEach((f) => {
    zipInput[f.name] = strToU8(f.text);
  });
  const zipped = zipSync(zipInput);
  // .slice() copies into a plain ArrayBuffer — zipSync's Uint8Array is
  // typed against Uint8Array's own underlying buffer, which strict DOM
  // lib typings don't accept directly as a BlobPart in every TS config.
  return [{ name: "MidNote-export.zip", blob: new Blob([zipped.slice()], { type: "application/zip" }) }];
}

// <a download> blob links — what this used to do — don't work on
// Android WebView. Not a MidNote bug: confirmed, still-open upstream
// Tauri limitation (tauri-apps/tauri#10280 — Android has no way to
// resolve a path for a blob link's implicit "download," so the tap
// silently does nothing).
//
// REVISION: the direct plugin-fs write to $DOWNLOAD below was meant to
// be the real fix, sidestepping the blob-link problem entirely — and it
// still is, on desktop. On-device testing on Android showed it silently
// not working there either, and looking into why turned up a real,
// documented gap rather than a MidNote-specific mistake: Tauri's own
// downloadDir()/BaseDirectory.Download docs describe Linux/macOS/
// Windows behavior specifically and say nothing about Android or iOS at
// all (contrast fontDir()/executableDir()/runtimeDir(), which
// explicitly say "Not supported" for the platforms that don't have one
// — Download isn't given that treatment either way), and real-world
// reports of using plugin-fs's BaseDirectory system on Android describe
// files created under it landing somewhere the OS's own Downloads app
// and file manager can't see, or the write being rejected outright —
// consistent with Android's scoped storage rules (strict since Android
// 11/API 30), which block direct writes to shared directories like the
// real Downloads folder unless the write goes through an API meant for
// exactly that. A plain writeFile+BaseDirectory call isn't one — which
// is also the whole reason dedicated community plugins
// (tauri-plugin-android-fs, tauri-plugin-scoped-storage) exist purely
// to work around this gap.
//
// The API that IS meant for it, and IS what Tauri's own docs show for
// this exact "let the user save a file" case: plugin-dialog's save(),
// which routes through Android's real file picker (Storage Access
// Framework) rather than a pre-declared path at all — the resulting
// path comes back already-granted for that one write, sidestepping
// scoped storage instead of running into it. Kept as the FALLBACK
// specifically, not the first attempt: it costs a picker tap per file
// where the direct write costs none, and the direct write is confirmed
// fine on desktop, so there's no reason to add that friction where
// nothing's actually broken. Only reached if the direct write throws —
// which is exactly the Android case, going by the above.
//
// NOT independently verifiable end-to-end from this sandbox — no real
// Android device, no way to compile-check the Rust/capability side here
// either (added tauri-plugin-dialog to Cargo.toml/capabilities/lib.rs
// alongside this — real, current crate and package versions, checked
// against the published registries rather than assumed — but whether
// the full permission chain actually grants what it's supposed to at
// runtime is on-device-only territory, same as the rest of this
// WebView-specific file). One known rough edge either way: Android has
// an open upstream report of the save dialog not honoring the
// suggested filename (tauri-apps/tauri#12942) — the picker will still
// open and work, just possibly without f.name pre-filled.
// FIFTH REVISION NOTE (still this same file — see the notes above for
// the full history): the dialog fallback above was tested on-device
// this round, in the same build as everything else, and downloads still
// didn't work — no picker opened, nothing landed anywhere visible,
// nothing reported as an error either. That specific combination (no
// error surfaced, fallback never visibly engaged) matches a case the
// research above didn't rule out: some Android WebView/plugin-fs
// combinations report BaseDirectory.Download writes as having
// *succeeded* — genuinely no thrown exception — while actually landing
// the file somewhere the OS's own Downloads app and file manager can't
// see, per the same real-world reports cited above. This function's
// fallback is gated on the first attempt throwing; if it doesn't throw,
// the function returns right after the "successful" write and the
// dialog is never reached at all — which would look exactly like this.
//
// Rather than keep guessing at whether THIS specific build throws or
// silently no-ops, removed the dependency on that distinction entirely:
// go straight to the dialog on Android, skip the direct write attempt
// there completely. iOS gets the same treatment on the same reasoning
// (also scoped-storage-restricted, not tested either way since there's
// no iOS build in this project's pipeline at all, but no reason to
// assume it's more permissive than Android here). Desktop is untouched
// — still the fast direct-write path, still confirmed fine there.
//
// navigator.userAgent rather than @tauri-apps/plugin-os: same
// information, without adding a third Tauri plugin (on top of fs and
// dialog already added this session) that also can't be compile-checked
// here. Standard WebView/Chromium behavior, not Tauri-specific — every
// Android WebView's user agent string contains "Android".
function isMobilePlatform(): boolean {
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function downloadFiles(files: ExportedFile[]): Promise<void> {
  if (isTauri()) {
    if (!isMobilePlatform()) {
      try {
        for (const f of files) {
          const bytes = new Uint8Array(await f.blob.arrayBuffer());
          await writeFile(f.name, bytes, { baseDir: BaseDirectory.Download });
        }
        return;
      } catch (err) {
        console.error("downloadFiles: plugin-fs write to $DOWNLOAD failed, falling back to save dialog:", err);
      }
    }

    try {
      for (const f of files) {
        const path = await save({ defaultPath: f.name });
        if (!path) continue; // user cancelled this file's dialog
        const bytes = new Uint8Array(await f.blob.arrayBuffer());
        await writeFile(path, bytes);
      }
      return;
    } catch (err) {
      console.error("downloadFiles: save-dialog fallback also failed, falling back to blob-link download:", err);
    }
  }

  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f.blob);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
}
