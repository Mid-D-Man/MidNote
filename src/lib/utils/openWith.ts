// Round K — "Open with MidNote". Plain TypeScript, no DOM, nothing here touches the phone.
//
// WHAT HAPPENS
// Android lists MidNote under "Open with" for a file (AndroidManifest intent-filter, added by the build workflow) and
// hands the app a content:// link. The app reads the bytes (utils/openWithNative.ts), then THIS file decides what the
// bytes are:
//
//   text      any text file (.txt .md .json .mdix, code, logs, ...)  -> offered as a new note
//   docx      a Word document                                      -> its text is offered as a new note (docxText.ts)
//   backup    a MidNote backup (.mdix / .mdix.enc / .mdix.key)       -> handed to Settings -> Backup & restore
//   refused   anything else (pictures, videos, apps, archives, ...) -> a plain "can't open that" message
//
// NOTHING IS EVER RUN
// A file is only ever READ AS DATA. Its text is escaped before it becomes a note (a "<script>" in an .html file is
// shown as the letters <script>, never parsed as a tag), it is never turned into a URL, a script or a page, it is never
// written anywhere, and the person confirms before a note is made. A file that looks like a program (.apk, .sh, .exe)
// is either not text (refused) or text (shown as inert text).

/** Most bytes the app will read from one file. The reader stops here, however large the file is. */
export const MAX_READ_BYTES = 8 * 1024 * 1024;
/** Most characters one opened file becomes as a note (a long novel is ~600k; the editor slows long before that). */
export const MAX_NOTE_CHARS = 300_000;

export function isContentUrl(url: string): boolean {
  return /^content:\/\//i.test(url);
}

/** The file's name when the link itself carries it (Downloads and the file manager do; many links don't). */
export function nameFromUrl(url: string): string | null {
  if (!isContentUrl(url)) return null;
  let path = url.replace(/[?#].*$/, "").replace(/^content:\/\/[^/]*/i, "");
  // providers encode the path (…/primary%3ADownload%2Fnotes.txt), some twice
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(path);
      if (d === path) break;
      path = d;
    } catch {
      break;
    }
  }
  const parts = path.split(/[\\/:]/).filter((p) => p.trim() !== "");
  const last = parts.length > 0 ? parts[parts.length - 1].trim() : "";
  // eslint-disable-next-line no-control-regex
  if (last.length === 0 || last.length > 120 || /[\u0000-\u001f<>"|?*]/.test(last)) return null;
  return /\.[A-Za-z0-9]{1,12}$/.test(last) ? last : null;
}

const lower = (s: string | null) => (s ?? "").toLowerCase();

export function isDocxName(name: string | null): boolean {
  return /\.docx$/.test(lower(name));
}

export type Decoded = { ok: true; text: string } | { ok: false; reason: "empty" | "binary" };

/** Bytes -> text, or "this isn't text". UTF-8 (with or without a byte-order mark) and UTF-16 with one. */
export function decodeText(bytes: Uint8Array): Decoded {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  let encoding = "utf-8";
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    start = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    start = 2;
  }
  // UTF-16 is two bytes per character: an odd number of bytes after the marker is not UTF-16 text
  if (encoding !== "utf-8" && (bytes.length - start) % 2 !== 0) return { ok: false, reason: "binary" };
  let text: string;
  try {
    // fatal: bytes that aren't valid text throw instead of being "repaired" into replacement characters
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return { ok: false, reason: "binary" };
  }
  if (text.indexOf("\u0000") !== -1) return { ok: false, reason: "binary" };
  // a few stray control characters are fine; a file full of them is not text
  const sample = text.length > 8000 ? text.slice(0, 8000) : text;
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if ((c < 9 || (c > 13 && c < 32) || c === 127) && c !== 27) ctrl++;
  }
  if (sample.length > 0 && ctrl / sample.length > 0.02) return { ok: false, reason: "binary" };
  return { ok: true, text: text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n") };
}

// ------------------------------------------------------------------ text -> note

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Indentation and runs of spaces survive the editor's whitespace collapsing as non-breaking spaces; tabs become 4. */
function keepSpacing(line: string): string {
  const lead = /^[ \t]+/.exec(line);
  let out = line;
  let head = "";
  if (lead) {
    head = lead[0].replace(/\t/g, "    ").replace(/ /g, "\u00a0");
    out = line.slice(lead[0].length);
  }
  out = out.replace(/\t/g, "    ").replace(/[ ]{2,}/g, (m) => " " + "\u00a0".repeat(m.length - 1));
  return head + out.replace(/[ \t\u00a0]+$/, "");
}

/** The file's text exactly as written: one <div> per line, everything escaped, NO Markdown or other reinterpretation. */
export function textToNoteHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((l) => (l.trim() === "" ? "<div></div>" : `<div>${escapeHtml(keepSpacing(l))}</div>`)).join("");
}

/** Keeps at most MAX_NOTE_CHARS, cutting at a line end where it can. */
export function clampForNote(text: string, limit: number = MAX_NOTE_CHARS): { text: string; cut: boolean } {
  if (text.length <= limit) return { text, cut: false };
  const head = text.slice(0, limit);
  const nl = head.lastIndexOf("\n");
  return { text: nl > limit * 0.8 ? head.slice(0, nl) : head, cut: true };
}

const TITLE_MAX = 80;

/** The note's title: the file name without its extension, else the first line of text, else a plain fallback. */
export function titleFor(name: string | null, text: string): string {
  if (name) {
    const t = name.replace(/\.[A-Za-z0-9]{1,12}$/, "").replace(/\s+/g, " ").trim();
    if (t) return t.slice(0, TITLE_MAX);
  }
  const first = text.split("\n").find((l) => l.trim() !== "");
  if (first) {
    let t = first.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
    if (t.length > 60) {
      const cut = t.slice(0, 60);
      const sp = cut.lastIndexOf(" ");
      t = (sp > 25 ? cut.slice(0, sp) : cut).trim();
    }
    if (t) return t;
  }
  return "Opened file";
}

// ------------------------------------------------------------------ classifying

export type Incoming =
  | { kind: "text"; name: string | null; text: string; cut: boolean; chars: number }
  | { kind: "docx"; name: string | null }
  | { kind: "backup"; name: string | null; part: "backup" | "key" | "encrypted" }
  | { kind: "refused"; name: string | null; message: string };

const NOT_OPENABLE = "MidNote opens text files (notes, code, JSON, Markdown…), Word documents (.docx) and its own backups.";

function isZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** A plain MidNote backup (DixScript text or the old JSON). Same marker the restore screen looks for. */
export function isBackupText(text: string): boolean {
  const head = text.trimStart();
  if (!text.includes('"midnote-backup"')) return false;
  return /@DATA\s*\(/.test(head.slice(0, 4000)) || head.startsWith("{");
}

/** A MidNote backup's key file (the .mdix.key saved beside a password-protected backup). */
export function isKeyFileText(text: string, name: string | null): boolean {
  const head = text.trimStart();
  if (head.startsWith("// DixScript Key File")) return true;
  return /\.key$/.test(lower(name)) && /\bkey_type\b/.test(head.slice(0, 2000));
}

/** What a file's bytes are. Synchronous; a "docx" still needs its text pulled out (docxText.ts). Never throws. */
export function classifyIncoming(name: string | null, bytes: Uint8Array): Incoming {
  if (bytes.length === 0) return { kind: "refused", name, message: "That file is empty." };

  if (isZip(bytes)) {
    if (name && !isDocxName(name)) return { kind: "refused", name, message: `That's a compressed file, not a text file or a Word document. ${NOT_OPENABLE}` };
    return { kind: "docx", name };
  }

  const decoded = decodeText(bytes);
  if (!decoded.ok) {
    if (decoded.reason === "binary" && /\.(mdix\.enc|enc)$/.test(lower(name))) return { kind: "backup", name, part: "encrypted" };
    const hint = name ? "" : " If it's a password-protected MidNote backup, use Settings → Backup & restore → Restore and pick it with its key file.";
    return { kind: "refused", name, message: `That isn't a text file. ${NOT_OPENABLE}${hint}` };
  }

  if (isBackupText(decoded.text)) return { kind: "backup", name, part: "backup" };
  if (isKeyFileText(decoded.text, name)) return { kind: "backup", name, part: "key" };

  const clamped = clampForNote(decoded.text);
  return { kind: "text", name, text: clamped.text, cut: clamped.cut, chars: decoded.text.length };
}
