// Round K — "Open with MidNote": a file the phone's "Open with" list handed to the app.
//
// utils/openWith.ts holds the rules (what a file is, how its text becomes a note); utils/openWithNative.ts is the
// phone side (the content:// link and the file's bytes). This store connects them and holds what the sheet shows.
//
// Nothing is created or changed until the person taps a button in the sheet. The file is read as DATA only and is never
// kept: after the sheet closes, only a note the person chose to create (or a backup handed to Backup & restore, which
// has its own preview) remains.
//
// Writes `openWith` only from event handlers / client callbacks, never from an $effect (docs/svelte5-effect-safety.md).
import { breadcrumb } from "$lib/debug/log.svelte";
import { saveEntry } from "$lib/stores/entries.svelte";
import { createNote } from "$lib/storage";
import { realOpenWithBackend } from "$lib/utils/openWithNative";
import { docxToText, DocxError } from "$lib/utils/docxText";
import { MAX_READ_BYTES, classifyIncoming, clampForNote, isContentUrl, nameFromUrl, textToNoteHtml, titleFor } from "$lib/utils/openWith";
import type { PickedFile } from "$lib/utils/backupFiles";

export interface OpenFile {
  name: string | null;
  /** Bytes read. */
  size: number;
  kind: "text" | "docx" | "backup" | "refused";
  /** text / docx: what the note would contain. "" otherwise. */
  text: string;
  /** text / docx: characters in the whole file's text (more than `text` when it was cut). */
  chars: number;
  cut: boolean;
  part: "backup" | "key" | "encrypted" | null;
  /** refused: what to tell the person. */
  message: string;
  /** backup: the bytes to hand to Backup & restore. */
  bytes: Uint8Array | null;
}

export const openWith = $state({
  /** Reading a file right now. */
  busy: false,
  /** What was read and is waiting for the person's choice. */
  file: null as OpenFile | null,
  /** A backup waiting for Backup & restore to open (when its screen wasn't already showing). */
  backup: null as PickedFile[] | null,
});

const LAST_COLD_KEY = "midnote:last-open-url";
let started = false;
let seq = 0;

function blank(name: string | null, size: number): OpenFile {
  return { name, size, kind: "refused", text: "", chars: 0, cut: false, part: null, message: "", bytes: null };
}

function refused(name: string | null, size: number, message: string): OpenFile {
  return { ...blank(name, size), message };
}

/** Reads and classifies one content:// link, then shows the sheet. Never throws. */
export async function openIncoming(url: string): Promise<void> {
  if (!isContentUrl(url)) return; // the midnote://auth sign-in link and anything else is not ours
  const backend = realOpenWithBackend();
  if (!backend) return;
  const mine = ++seq;
  openWith.busy = true;
  openWith.file = null;
  const name = nameFromUrl(url);
  try {
    const bytes = await backend.read(url, MAX_READ_BYTES);
    if (mine !== seq) return; // the person closed the sheet, or another file came in
    let file: OpenFile;
    if (bytes.length > MAX_READ_BYTES) {
      file = refused(name, bytes.length, "That file is too big to open (the limit is 8 MB).");
    } else {
      const c = classifyIncoming(name, bytes);
      if (c.kind === "refused") file = refused(name, bytes.length, c.message);
      else if (c.kind === "backup") file = { ...blank(name, bytes.length), kind: "backup", part: c.part, bytes };
      else if (c.kind === "text") file = { ...blank(name, bytes.length), kind: "text", text: c.text, chars: c.chars, cut: c.cut };
      else {
        let text: string | null;
        try {
          text = await docxToText(bytes);
        } catch (e) {
          text = null;
          if (e instanceof DocxError) {
            if (mine !== seq) return;
            openWith.file = refused(name, bytes.length, e.message);
            breadcrumb(`open with: docx refused (${e.kind})`);
            return;
          }
        }
        if (mine !== seq) return;
        if (text === null) file = refused(name, bytes.length, "That isn't a Word document that MidNote can read.");
        else if (text.trim() === "") file = refused(name, bytes.length, "That document has no text in it.");
        else {
          const clamped = clampForNote(text);
          file = { ...blank(name, bytes.length), kind: "docx", text: clamped.text, chars: text.length, cut: clamped.cut };
        }
      }
    }
    breadcrumb(`open with: ${file.kind}${file.part ? ` (${file.part})` : ""}, ${file.size} bytes`);
    openWith.file = file;
  } catch (e) {
    if (mine !== seq) return;
    breadcrumb(`open with: couldn't read the file (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
    openWith.file = refused(name, 0, "MidNote couldn't read that file. Try opening it again, or save a copy to your phone first.");
  } finally {
    if (mine === seq) openWith.busy = false;
  }
}

/** Starts listening: for files opened while the app runs, and for the file that started the app. Safe to call twice. */
export async function startOpenWith(): Promise<void> {
  if (started) return;
  started = true;
  const backend = realOpenWithBackend();
  if (!backend) return;
  try {
    await backend.onUrl((url) => void openIncoming(url));
    for (const url of await backend.getCurrent()) {
      if (!isContentUrl(url)) continue;
      // The plugin keeps the app's launch link for as long as the app runs, so a page reload would offer the same
      // file again: remember which one this session already showed.
      let seen = false;
      try {
        seen = sessionStorage.getItem(LAST_COLD_KEY) === url;
        sessionStorage.setItem(LAST_COLD_KEY, url);
      } catch {
        /* no session storage: show it */
      }
      if (!seen) await openIncoming(url);
    }
  } catch (e) {
    breadcrumb(`open with: unavailable (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
  }
}

/** Closes the sheet and forgets the file. Also stops a read that is still going. */
export function dismissOpenFile(): void {
  seq++;
  openWith.busy = false;
  openWith.file = null;
}

/** Makes a note from the open text/Word file and closes the sheet. Returns the note's id, or null. */
export function createNoteFromOpenFile(): string | null {
  const f = openWith.file;
  if (!f || (f.kind !== "text" && f.kind !== "docx") || f.text.trim() === "") return null;
  const n = createNote();
  n.title = titleFor(f.name, f.text);
  // The text goes in exactly as written, escaped (utils/openWith.ts textToNoteHtml): never parsed as markup.
  n.content = textToNoteHtml(f.text);
  saveEntry(n);
  breadcrumb(`open with: note created from ${f.kind} file (${f.text.length} chars)`);
  openWith.file = null;
  return n.id;
}

// ------------------------------------------------------------------ handing a backup to Backup & restore

let backupSink: ((files: PickedFile[]) => void) | null = null;

/** Backup & restore calls this while its screen is showing, so a backup opened meanwhile goes straight to it. */
export function registerBackupSink(fn: (files: PickedFile[]) => void): () => void {
  backupSink = fn;
  return () => {
    if (backupSink === fn) backupSink = null;
  };
}

/** A backup that arrived while Backup & restore wasn't showing: taken (once) when that screen opens. */
export function takeStashedBackup(): PickedFile[] | null {
  const f = openWith.backup;
  openWith.backup = null;
  return f;
}

/** Hands the open backup file on and closes the sheet. False when there is none. The caller then shows the screen. */
export function sendOpenFileToBackup(): boolean {
  const f = openWith.file;
  if (!f || f.kind !== "backup" || !f.bytes) return false;
  const fallback = f.part === "encrypted" ? "incoming.mdix.enc" : f.part === "key" ? "incoming.mdix.key" : "incoming.mdix";
  const files: PickedFile[] = [{ name: f.name ?? fallback, bytes: f.bytes }];
  openWith.file = null;
  if (backupSink) backupSink(files);
  else openWith.backup = files;
  return true;
}
