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
// silently does nothing). The real fix is writing the bytes directly
// via plugin-fs instead of asking the WebView to download anything.
// $DOWNLOAD specifically because it has its own dedicated permission
// (fs:allow-download-write, see capabilities/default.json) that bundles
// the write_file command with a pre-set scope for that one directory —
// no save-dialog picker needed, and no per-file dialog friction for
// "separate"-format multi-file exports either, since every file just
// writes straight there in one pass.
//
// isTauri()-gated rather than a bare try/catch on plugin-fs directly:
// the fs plugin's write call will always reject when there's no Tauri
// IPC backend to answer it — which is the ordinary, expected case when
// this runs via `npm run dev` in a plain browser tab rather than inside
// the actual app. Checking first keeps that expected case from being
// logged as though it were a real failure; genuine on-device errors
// (permission denied, disk full, whatever) still fall through to the
// blob-link path below as a last resort rather than a dead end, and
// still get logged, since those ARE worth knowing about.
//
// NOT independently verifiable end-to-end from this sandbox — no real
// Android device, no way to compile-check the Rust/capability/manifest
// side that has to be configured for fs:allow-download-write to
// actually grant anything at runtime (see the manifest and capabilities
// changes shipped alongside this). The API surface itself (writeFile's
// signature, BaseDirectory.Download, isTauri()) was checked against the
// real installed package's type definitions, not assumed from memory or
// documentation alone — but whether the full permission chain actually
// grants write access on a real device is on-device-only territory,
// same as everything else this WebView-specific.
export async function downloadFiles(files: ExportedFile[]): Promise<void> {
  if (isTauri()) {
    try {
      for (const f of files) {
        const bytes = new Uint8Array(await f.blob.arrayBuffer());
        await writeFile(f.name, bytes, { baseDir: BaseDirectory.Download });
      }
      return;
    } catch (err) {
      console.error("downloadFiles: plugin-fs write to $DOWNLOAD failed, falling back to blob-link download:", err);
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
