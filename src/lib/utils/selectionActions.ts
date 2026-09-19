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
    // Common case, unchanged: a plain single-page note reads exactly as
    // it always has, no "Page 1" heading nobody asked for.
    if (entry.pages.length === 0) {
      return `${entry.title || "Untitled"}\n\n${htmlToPlainText(entry.content)}`;
    }
    // BUGFIX: this used to read only entry.content — every note with
    // additional pages (see entry.ts's Note.pages comment) silently
    // lost everything past page 1 on export/send. Each page is now
    // included in order, under its custom name if it has one (see
    // PagesPanel.svelte) or the auto-numbered fallback otherwise.
    const parts = [entry.title || "Untitled", "", `--- ${entry.page1Name || "Page 1"} ---`, htmlToPlainText(entry.content)];
    entry.pages.forEach((p, i) => {
      parts.push("", `--- ${p.name || `Page ${i + 2}`} ---`, htmlToPlainText(p.content));
    });
    return parts.join("\n").trim();
  }
  // A board is a spatial arrangement, not prose — there's no honest
  // plain-text rendering of "these four cards, positioned like this,
  // connected like that." Rather than invent one that silently loses
  // the only thing a board actually encodes (the layout and the
  // connections), export a readable inventory: every node, then every
  // connection between them by name. Enough to see what was on the
  // board in a text file; explicitly not a round-trippable format.
  if (entry.type === "board") {
    const out: string[] = [entry.title || "Untitled", ""];
    if (entry.nodes.length === 0) {
      out.push("(empty board)");
      return out.join("\n").trim();
    }
    const nameOf = new Map(entry.nodes.map((n) => [n.id, n.label || "Untitled"]));
    out.push("--- Nodes ---");
    for (const n of entry.nodes) {
      out.push(n.body ? `${n.label || "Untitled"}: ${n.body}` : n.label || "Untitled");
    }
    if (entry.edges.length > 0) {
      out.push("", "--- Connections ---");
      for (const e of entry.edges) {
        out.push(`${nameOf.get(e.source) ?? "?"} -> ${nameOf.get(e.target) ?? "?"}`);
      }
    }
    return out.join("\n").trim();
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
  // BUGFIX (found by feeding this a deliberately hostile title): the
  // character class here covered the Windows-reserved punctuation but
  // not CONTROL characters, so a title containing a newline — easy to
  // produce by pasting into the title field — sailed through and
  // produced a filename with a literal line break in it. Android's
  // save-file picker and every desktop filesystem reject that. Control
  // characters are now collapsed to the same "-" as the rest, and
  // runs of separators are squeezed so "a\n\nb" doesn't become
  // "a--b".
  const base = (title || fallback)
    .replace(/[\\/:*?"<>|]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "-")
    .replace(/-{2,}/g, "-")
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .slice(0, 80);
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
  // Page 1 behavior is unchanged: every selected note's main content,
  // <hr>-joined into one combined first page — nothing changes here for
  // the common case of merging plain, single-page notes.
  merged.content = selected.map((n) => n.content).join("<hr>");

  // BUGFIX: every selected note's OWN additional pages (see entry.ts's
  // Note.pages comment) used to be silently dropped on merge — only
  // page 1 ever made it into the result. They're now appended after the
  // combined first page above, in source order, so merging paged notes
  // doesn't lose anything past page 1. Fresh ids throughout — two
  // different source notes could each independently contain a page
  // with the same id, and blindly concatenating would risk a collision
  // no single source ever had a chance to see (same reasoning
  // mergeTodos already applies to steps/annotations below). A source
  // note's own custom page1Name isn't carried over onto anything here —
  // its page 1 *content* is still fully preserved inside the combined
  // blob above, just no longer as a page of its own to attach that
  // label to.
  //
  // Duplicate custom page NAMES (two different source notes each had a
  // page called e.g. "Ingredients") get an auto-suffix — same " (2)",
  // " (3)" convention dedupeFileNames below already uses for repeated
  // export filenames, rather than inventing a second convention for the
  // same kind of collision. Unnamed pages are left alone: with no
  // custom name they just fall back to their position ("Page N") in the
  // panel, which is unique by construction.
  const seenPageNames = new Map<string, number>();
  const dedupedPageName = (name: string | null): string | null => {
    if (!name) return null;
    const count = seenPageNames.get(name) ?? 0;
    seenPageNames.set(name, count + 1);
    return count === 0 ? name : `${name} (${count})`;
  };
  merged.pages = selected.flatMap((n) =>
    n.pages.map((p) => ({ id: generateId(), content: p.content, name: dedupedPageName(p.name) })),
  );

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

// --- Encrypted backup export ---
// Lets a locked entry be backed up/exported WITHOUT ever unlocking it —
// the file this produces is just the ciphertext + key-file content
// already sitting on the entry (see lockFlow.ts's performLock/
// entry.lockedPayload/entry.lockedKeyFile), the exact bytes crypto.rs's
// lock_payload/unlock_payload already round-trip through. Nothing here
// decrypts or even reads the plaintext — this is deliberately the
// counterpart to buildExportFiles() above, not a variant of it: Export
// on a locked note/todo used to either silently do nothing (the
// original bug) or would otherwise have to choose between leaking
// plaintext or refusing entirely, and refusing entirely throws away a
// legitimate use case (backing up a locked entry's data before, say,
// reinstalling the app) for no real safety gain, since this file is
// exactly as safe at rest as the entry already is while locked — it's
// the same ciphertext, just also sitting in $DOWNLOAD. See
// NoteEditorHeader/TodoHeader's handleDownload for where this branches
// from the normal plaintext export based on entry.encrypted.
export function buildEncryptedBackupFile(entry: Entry): ExportedFile {
  // Emitted as a real .mdix file rather than JSON: DixScript is this
  // project's own data-interchange format, the storage schema already
  // mirrors it (see entry.ts's header comment), and the encryption on
  // the other side of this is DixScript's own (src-tauri/src/data/
  // crypto.rs). A backup of an encrypted entry written in anything
  // else would be the one MidNote artifact that ISN'T .mdix.
  //
  // Nothing here decrypts or reads plaintext — lockedPayload and
  // lockedKeyFile are copied verbatim from the entry, which is exactly
  // what's already sitting in storage while it's locked. This file is
  // therefore no less safe at rest than the locked entry itself.
  //
  // Values are emitted through mdixString() below rather than
  // interpolated raw; a stray quote or backslash inside a base64
  // payload would otherwise produce a file the real parser rejects.
  const lines = [
    "// Brought to u by MidManStudio",
    "@CONFIG(",
    '  version    -> "1.0.0"',
    '  features   -> "data"',
    '  debug_mode -> "off"',
    ")",
    "",
    "@DATA(",
    `  app = ${mdixString("MidNote")}`,
    `  format = ${mdixString("encrypted-backup")}`,
    "  format_version = 1",
    `  entry_type = ${mdixString(entry.type)}`,
    `  entry_id = ${mdixString(entry.id)}`,
    `  title = ${mdixString(entry.title)}`,
    `  lock_key_mode = ${mdixString(entry.lockKeyMode ?? "")}`,
    `  locked_payload = ${mdixString(entry.lockedPayload ?? "")}`,
    `  locked_key_file = ${mdixString(entry.lockedKeyFile ?? "")}`,
    ")",
    "",
  ];
  return {
    name: `${safeFileName(entry.title, "entry")}.mdix`,
    blob: new Blob([lines.join("\n")], { type: "text/plain" }),
  };
}

// Minimal DixScript string literal escaping. Only backslash and the
// double quote actually need escaping inside one; newlines are escaped
// too so a title typed with a line break can't terminate the literal
// early and produce an unparseable file.
function mdixString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
  return `"${escaped}"`;
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
