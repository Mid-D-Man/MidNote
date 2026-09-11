// Orchestrates the Lock feature's UI flow (choice + password dialogs,
// via lockPrompt.svelte.ts) around the two Tauri commands in
// src-tauri/src/commands/crypto.rs. This is the ONLY file that calls
// those commands — CardOverflowMenu's onToggleLock and the note/todo
// editor pages' "Unlock" button both just call lockEntry()/unlockEntry()
// from here and let it handle everything (which dialog to show, when,
// with what error message).
//
// Password handling summary (see lockSession.svelte.ts for the fuller
// reasoning on why there's no persisted app-password storage anywhere):
// - "app" mode: uses sessionAppPassword if already set this session;
//   otherwise prompts once (with confirm) and that becomes the app
//   password going forward, for the rest of this session only.
// - "custom" mode: always prompts (with confirm at lock time, without
//   at unlock time), never cached.
// - Unlock retries on a wrong password rather than giving up — dixscript
//   doesn't distinguish "wrong password" from other failures in its
//   error strings, so any failure here is treated as that (the only
//   realistic cause once stored ciphertext/key content are known-good,
//   which they always are here since this app never edits them by hand).
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Note, Todo } from "$lib/types/entry";
import { askLockChoice, askPassword } from "$lib/stores/lockPrompt.svelte";
import { sessionAppPassword, setSessionAppPassword } from "$lib/stores/lockSession.svelte";
import { pushToast } from "$lib/stores/toast.svelte";
import { breadcrumb } from "$lib/debug/log.svelte";
import { saveEntry } from "$lib/stores/entries.svelte";

interface LockedPayloadResult {
  encryptedDataB64: string;
  keyFileContent: string;
}

function buildPlaintextPayload(entry: Note | Todo): string {
  // Tags used to travel inside this payload (see clearPlaintextFields'
  // old comment) because locking cleared them from the visible entry.
  // That's no longer true — tags now stay visible on a locked card (see
  // clearPlaintextFields below) — so a NEW lock has no reason to
  // duplicate them in here too. applyDecryptedPayload still reads
  // `payload.tags` as a fallback purely for entries locked BEFORE this
  // change, whose stored payload already has them from that older lock.
  if (entry.type === "regular") {
    return JSON.stringify({ content: entry.content });
  }
  return JSON.stringify({ steps: entry.steps, annotations: entry.annotations });
}

function applyDecryptedPayload(entry: Note | Todo, plaintextJson: string) {
  const payload = JSON.parse(plaintextJson);
  if (entry.type === "regular") {
    entry.content = payload.content;
  } else {
    entry.steps = payload.steps;
    entry.annotations = payload.annotations;
  }
  // BUGFIX/BACKWARD-COMPAT: tags now stay on the visible entry through a
  // lock (see clearPlaintextFields), so for anything locked under THAT
  // scheme entry.tags already holds the real tags and this payload has
  // no tags field at all to conflict with them. Only entries locked
  // BEFORE this change have both `entry.tags === []` (the old
  // clear-on-lock behavior) AND a real tags array inside their stored
  // payload (the old carry-tags-in-payload behavior) — restore from
  // there ONLY in that specific case, so those older locked notes don't
  // come back from their first post-upgrade unlock with tags silently
  // missing.
  if (entry.tags.length === 0 && Array.isArray(payload.tags)) {
    entry.tags = payload.tags;
  }
}

function clearPlaintextFields(entry: Note | Todo) {
  if (entry.type === "regular") {
    entry.content = "";
  } else {
    entry.steps = [];
    entry.annotations = [];
  }
  // BUGFIX: tags used to be cleared here too (matching
  // notes_index.mdix/todos_index.mdix's old "encrypted keeps title,
  // empties tags" convention) — a locked card showed literally nothing
  // to go on besides its title. Tags aren't sensitive content the way a
  // note's body is, and being able to see them is genuinely useful for
  // finding/organizing a locked note without unlocking it — so they now
  // stay exactly as they were at lock time. The Tags row in
  // CardOverflowMenu stays hidden while encrypted regardless (see that
  // component) — visible, not editable, until unlocked.
}

/** Locks `entry` in place (mutates it) and persists via saveEntry(). Returns whether it actually got locked (false = the user cancelled somewhere). */
export async function lockEntry(entry: Note | Todo): Promise<boolean> {
  if (!isTauri()) {
    pushToast({ title: "Lock needs the app", description: "Encryption only works in the installed app, not this preview.", variant: "destructive" });
    return false;
  }
  if (entry.encrypted) return false;

  const choice = await askLockChoice();
  if (!choice) return false;

  let password: string;
  if (choice === "app") {
    if (sessionAppPassword.value) {
      password = sessionAppPassword.value;
    } else {
      const p = await askPassword("Set your app password", "Used for every note/todo you lock with \u201cUse app password.\u201d Remembered only until you close the app.", true);
      if (!p) return false;
      password = p;
    }
  } else {
    const p = await askPassword("Set a password for this note", "Only this note or todo uses it — nothing else is remembered.", true);
    if (!p) return false;
    password = p;
  }

  breadcrumb(`lockFlow: locking entry ${entry.id} (${choice} mode)`);
  try {
    const plaintextJson = buildPlaintextPayload(entry);
    const result = await invoke<LockedPayloadResult>("lock_payload", { plaintextJson, password });
    clearPlaintextFields(entry);
    entry.encrypted = true;
    entry.lockKeyMode = choice;
    entry.lockedPayload = result.encryptedDataB64;
    entry.lockedKeyFile = result.keyFileContent;
    saveEntry(entry);
    if (choice === "app") setSessionAppPassword(password);
    pushToast({ title: "Locked", description: "This note is now locked." });
    return true;
  } catch (err) {
    console.error("lockFlow: lock_payload failed:", err);
    pushToast({ title: "Couldn't lock this", description: String(err), variant: "destructive" });
    return false;
  }
}

/** Unlocks `entry` in place (mutates it) and persists via saveEntry(). Returns whether it actually got unlocked (false = cancelled). Retries on a wrong password rather than giving up after one try. */
export async function unlockEntry(entry: Note | Todo): Promise<boolean> {
  if (!isTauri()) {
    pushToast({ title: "Unlock needs the app", description: "Encryption only works in the installed app, not this preview.", variant: "destructive" });
    return false;
  }
  if (!entry.encrypted || !entry.lockedPayload || !entry.lockedKeyFile) return false;

  let password = entry.lockKeyMode === "app" ? sessionAppPassword.value : null;
  let error: string | null = null;

  while (true) {
    if (!password) {
      const title = entry.lockKeyMode === "app" ? "Enter your app password" : "Enter this note's password";
      const p = await askPassword(title, "", false, error);
      if (!p) return false;
      password = p;
    }

    breadcrumb(`lockFlow: attempting unlock for entry ${entry.id} (${entry.lockKeyMode} mode)`);
    try {
      const plaintextJson = await invoke<string>("unlock_payload", {
        encryptedDataB64: entry.lockedPayload,
        keyFileContent: entry.lockedKeyFile,
        password,
      });
      // Capture BEFORE clearing — entry.lockKeyMode gets nulled out two
      // lines down, so checking it after that point would always read
      // null and this would never actually remember an app password.
      const wasAppMode = entry.lockKeyMode === "app";
      applyDecryptedPayload(entry, plaintextJson);
      entry.encrypted = false;
      entry.lockKeyMode = null;
      entry.lockedPayload = null;
      entry.lockedKeyFile = null;
      saveEntry(entry);
      if (wasAppMode) setSessionAppPassword(password);
      pushToast({ title: "Unlocked", description: "This note has been unlocked." });
      return true;
    } catch (err) {
      console.error("lockFlow: unlock_payload failed:", err);
      error = "Wrong password. Try again.";
      password = null;
    }
  }
}
