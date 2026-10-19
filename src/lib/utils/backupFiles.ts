// Backup files: what gets SAVED and how a PICKED set of files is recognised.
//
//   no password   midnote-backup-DATE.mdix                      plain DixScript text (backupMdix.ts)
//   password      midnote-backup-DATE.mdix.enc                  the DixScript-encrypted backup
//                 midnote-backup-DATE.mdix.key                  its key file (the encryption's own key file:
//                                                               it holds the key-derivation settings, the password
//                                                               is still needed to open the backup)
//
// The encryption is the one the locked notes already use (the lock_payload / unlock_payload Tauri commands:
// DixScript's DLM, AES-256-GCM with an Argon2id key from the password). Nothing new in Rust.
//
// RESTORE: Android's file picker only hands over the files that were picked - an app cannot look into the
// folder next to a picked file. So "find the matching key file in the same place" works like this: the picker
// allows selecting several files at once; a .mdix.enc is paired with the .mdix.key picked with it (by name when
// there are several, otherwise the only one), and if no key file came along the screen asks for it. Files are
// recognised by their CONTENT, not their names, because Android renames duplicates ("name (1).mdix.enc").
//
// Plain TypeScript with the crypto injected, so it runs in Node. The default crypto is the Tauri commands; a test
// can replace it through globalThis.__midnoteBackupCrypto.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { backupBaseName, base64ToBytes, bytesToBase64, parseBackup, serializeBackup, type BackupFile, type ParseResult } from "./backup";

export interface BackupCrypto {
  lock(plaintext: string, password: string): Promise<{ encryptedDataB64: string; keyFileContent: string }>;
  unlock(encryptedDataB64: string, keyFileContent: string, password: string): Promise<string>;
}

export function tauriBackupCrypto(): BackupCrypto {
  return {
    lock: (plaintextJson, password) => invoke("lock_payload", { plaintextJson, password }),
    unlock: (encryptedDataB64, keyFileContent, password) => invoke("unlock_payload", { encryptedDataB64, keyFileContent, password }),
  };
}

export function getBackupCrypto(): BackupCrypto {
  const seam = (globalThis as { __midnoteBackupCrypto?: BackupCrypto }).__midnoteBackupCrypto;
  return seam ?? tauriBackupCrypto();
}

/** Encryption exists in the installed app (or when a test has supplied its own). */
export function cryptoAvailable(): boolean {
  return (globalThis as { __midnoteBackupCrypto?: unknown }).__midnoteBackupCrypto !== undefined || isTauri();
}

export interface OutFile {
  name: string;
  bytes: Uint8Array;
  type: string;
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

const enc = new TextEncoder();

// ------------------------------------------------------------------ saving

/** The file(s) to save: one .mdix, or (with a password) the .mdix.enc and its .mdix.key. */
export async function makeBackupFiles(
  backup: BackupFile,
  opts: { password?: string; now?: Date; crypto?: BackupCrypto } = {},
): Promise<OutFile[]> {
  const base = backupBaseName(opts.now);
  const text = serializeBackup(backup);
  if (opts.password === undefined || opts.password === "") {
    return [{ name: `${base}.mdix`, bytes: enc.encode(text), type: "text/plain" }];
  }
  const crypto = opts.crypto ?? getBackupCrypto();
  const locked = await crypto.lock(text, opts.password);
  return [
    { name: `${base}.mdix.enc`, bytes: base64ToBytes(locked.encryptedDataB64), type: "application/octet-stream" },
    { name: `${base}.mdix.key`, bytes: enc.encode(locked.keyFileContent), type: "text/plain" },
  ];
}

// ------------------------------------------------------------------ recognising

type Sniff = { kind: "plain" | "json" | "key" | "unknown"; text: string } | { kind: "enc" };

function sniff(f: PickedFile): Sniff {
  const b = f.bytes;
  if (b.length === 0) return { kind: "unknown", text: "" };
  let text: string;
  try {
    // fatal: bytes that are not valid UTF-8 text (the encrypted file) throw instead of being repaired
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return { kind: "enc" };
  }
  if (text.indexOf("\u0000") !== -1) return { kind: "enc" };
  const head = text.trimStart(); // also drops a byte-order mark
  if (head.startsWith("{")) return { kind: "json", text };
  if (head.startsWith("// DixScript Key File") || /\bkey_type\b/.test(head.slice(0, 2000))) return { kind: "key", text };
  if (/@DATA\s*\(/.test(head) && head.includes('"midnote-backup"')) return { kind: "plain", text };
  return { kind: "unknown", text };
}

export type Classified =
  | { kind: "plain"; text: string }
  | { kind: "encrypted"; enc: Uint8Array; key: string | null }
  | { kind: "key-only" }
  | { kind: "invalid"; message: string };

/** The file name without .mdix.enc / .mdix.key / .mdix, lower-cased, ignoring "(1)" style copies. */
function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(\d+\)/g, "")
    .replace(/\.(mdix\.enc|mdix\.key|enc|key|mdix|json)$/, "");
}

/** Works out what the picked files are. Never throws. */
export function classifyPicked(files: PickedFile[]): Classified {
  if (files.length === 0) return { kind: "invalid", message: "No file was picked." };
  if (files.length > 6) return { kind: "invalid", message: "Pick the backup file, and its key file if it has one. That's at most two files." };
  const sniffed = files.map((f) => ({ f, s: sniff(f) }));

  for (const x of sniffed) {
    if (x.s.kind === "plain" || x.s.kind === "json") return { kind: "plain", text: x.s.text };
  }

  const encs = sniffed.filter((x) => x.s.kind === "enc");
  const keys = sniffed.filter((x) => x.s.kind === "key") as Array<{ f: PickedFile; s: { kind: "key"; text: string } }>;
  if (encs.length > 0) {
    const first = encs[0].f;
    let key = keys.find((k) => stem(k.f.name) === stem(first.name)) ?? null;
    if (!key && keys.length === 1 && encs.length === 1) key = keys[0];
    if (!key && keys.length > 0) key = keys[0];
    return { kind: "encrypted", enc: first.bytes, key: key ? key.s.text : null };
  }
  if (keys.length > 0) return { kind: "key-only" };
  return { kind: "invalid", message: "That isn't a MidNote backup." };
}

// ------------------------------------------------------------------ opening

export type OpenResult = ParseResult | { ok: false; message: string; wrongPassword: true };

/** Opens a recognised backup. For an encrypted one, `password` is required. */
export async function openClassified(c: Classified, password: string | null, crypto: BackupCrypto = getBackupCrypto()): Promise<OpenResult> {
  switch (c.kind) {
    case "plain":
      return parseBackup(c.text);
    case "key-only":
      return { ok: false, message: "That's a key file. Pick the backup file (.mdix.enc) together with it." };
    case "invalid":
      return { ok: false, message: c.message };
    case "encrypted": {
      if (c.key === null) return { ok: false, message: "This backup is encrypted. Pick its key file (.mdix.key) too." };
      if (!password) return { ok: false, message: "Enter the backup's password." };
      let text: string;
      try {
        text = await crypto.unlock(bytesToBase64(c.enc), c.key, password);
      } catch {
        return { ok: false, wrongPassword: true, message: "That password doesn't open this backup (or the key file belongs to a different backup)." };
      }
      return parseBackup(text);
    }
  }
}
