// Orchestrates the Lock feature's UI flow (choice + password dialogs,
// via lockPrompt.svelte.ts) around the two Tauri commands in
// src-tauri/src/commands/crypto.rs. This is the ONLY file that calls
// those commands — CardOverflowMenu's onToggleLock and the note/todo
// editor pages' "Unlock" button both just call functions from here and
// let it handle everything (which dialog to show, when, with what error
// message).
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
//
// SESSION UNLOCK vs PERMANENT UNLOCK (added alongside page rename/relock
// fixes): unlockEntry() below is the PERMANENT unlock — the kebab menu's
// "Unlock" action. It's meant to actually remove the lock forever:
// clears the lock key material and leaves the entry as plain, unlocked
// data going forward, same as if it had never been locked.
//
// That's a different, stronger action than just opening a locked note
// to look at or edit it. Previously both used this same function, which
// meant simply tapping into a locked note — even without touching
// anything — silently and permanently stripped its lock the moment the
// password was entered, and nothing ever put it back (confirmed: this
// is also why the list's own delete-gate looked "bypassable" — by the
// time you were back at the list, the note genuinely wasn't encrypted
// anymore, so the gate correctly let it through). unlockForSession() and
// relockSilently() below exist specifically to give the note/todo editor
// pages a temporary, session-scoped unlock instead: it decrypts for
// viewing/editing exactly like a permanent unlock does (same crypto,
// same in-memory state), but hands the caller back the password and
// mode used so the editor page can silently re-lock with it — no second
// password prompt — the moment the user actually navigates away. See
// the onNavigate hook in the note/todo [id]/+page.svelte files.
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Entry, LockKeyMode } from "$lib/types/entry";
import { askLockChoice, askPassword } from "$lib/stores/lockPrompt.svelte";
import { sessionAppPassword, setSessionAppPassword } from "$lib/stores/lockSession.svelte";
import { pushToast } from "$lib/stores/toast.svelte";
import { breadcrumb } from "$lib/debug/log.svelte";
import { saveEntry } from "$lib/stores/entries.svelte";
import { beginGlobalBusy, endGlobalBusy } from "$lib/stores/globalBusy.svelte";

interface LockedPayloadResult {
  encryptedDataB64: string;
  keyFileContent: string;
}

function buildPlaintextPayload(entry: Entry): string {
  // Tags used to travel inside this payload (see clearPlaintextFields'
  // old comment) because locking cleared them from the visible entry.
  // That's no longer true — tags now stay visible on a locked card (see
  // clearPlaintextFields below) — so a NEW lock has no reason to
  // duplicate them in here too. applyDecryptedPayload still reads
  // `payload.tags` as a fallback purely for entries locked BEFORE this
  // change, whose stored payload already has them from that older lock.
  //
  // `pages`/`page1Name` (notes only): additional pages beyond the
  // note's own main content, each optionally custom-named — see
  // entry.ts's Note.pages/page1Name comments. MUST travel inside this
  // same encrypted payload alongside content, or locking a multi-page
  // note would silently discard every page (and its name) past the
  // first the moment clearPlaintextFields runs, with no way back.
  //
  // `nodes`/`edges`/`viewport` (boards only): a board's entire meaning
  // lives in those three fields, so they travel here for exactly the
  // same reason a note's content does — clearPlaintextFields empties
  // them on the visible entry, and this payload is the only place the
  // real values survive a lock.
  if (entry.type === "regular") {
    return JSON.stringify({ content: entry.content, pages: entry.pages, page1Name: entry.page1Name });
  }
  if (entry.type === "board") {
    return JSON.stringify({ nodes: entry.nodes, edges: entry.edges, viewport: entry.viewport });
  }
  return JSON.stringify({ steps: entry.steps, annotations: entry.annotations });
}

function applyDecryptedPayload(entry: Entry, plaintextJson: string) {
  const payload = JSON.parse(plaintextJson);
  if (entry.type === "regular") {
    entry.content = payload.content;
    // Defensive fallback to [] rather than trusting payload.pages is
    // always an array — this app never hand-edits stored ciphertext,
    // but a malformed/foreign payload landing here shouldn't leave
    // entry.pages as undefined and break every .pages.length /
    // .pages[i] access elsewhere.
    entry.pages = Array.isArray(payload.pages) ? payload.pages : [];
    // Same defensive treatment — only present on payloads written after
    // page renaming shipped, so anything older just falls back to null
    // (auto-numbered "Page 1").
    entry.page1Name = typeof payload.page1Name === "string" ? payload.page1Name : null;
  } else if (entry.type === "board") {
    // Same defensive array handling as pages above — a board whose
    // payload came back malformed should open as an empty board, not
    // leave .nodes undefined and break every .length/.map on it.
    entry.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    entry.edges = Array.isArray(payload.edges) ? payload.edges : [];
    entry.viewport = payload.viewport ?? null;
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

function clearPlaintextFields(entry: Entry) {
  if (entry.type === "regular") {
    entry.content = "";
    // Same reasoning as content — the real pages (and their names) live
    // inside the encrypted payload now (see buildPlaintextPayload
    // above), so the visible record is cleared the same way content is,
    // not just left populated with plaintext page content while
    // "locked".
    entry.pages = [];
    entry.page1Name = null;
  } else if (entry.type === "board") {
    entry.nodes = [];
    entry.edges = [];
    entry.viewport = null;
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

/**
 * Core lock crypto + state mutation, no dialogs. Shared by lockEntry()
 * (prompts first) and relockSilently() (reuses a password already known
 * from a prior unlockForSession() call). Wraps the actual invoke() call
 * in the app-wide busy overlay — see globalBusy.svelte.ts — since this
 * is the genuinely slow part (Argon2id is a deliberately memory-hard
 * KDF; see crypto.rs's kdf_* fields), not the surrounding bookkeeping.
 */
async function performLock(entry: Entry, password: string, mode: LockKeyMode): Promise<void> {
  const plaintextJson = buildPlaintextPayload(entry);
  beginGlobalBusy("Locking…");
  let result: LockedPayloadResult;
  try {
    result = await invoke<LockedPayloadResult>("lock_payload", { plaintextJson, password });
  } finally {
    endGlobalBusy();
  }
  clearPlaintextFields(entry);
  entry.encrypted = true;
  entry.lockKeyMode = mode;
  entry.lockedPayload = result.encryptedDataB64;
  entry.lockedKeyFile = result.keyFileContent;
  saveEntry(entry);
}

/**
 * Core unlock crypto + state mutation for a single attempt, no
 * dialogs/retry. Shared by unlockEntry() and unlockForSession(). Throws
 * on a wrong password / crypto failure — callers handle the retry loop.
 * Same busy-overlay wrapping as performLock() above, and for the same
 * reason.
 */
async function performUnlock(entry: Entry, password: string): Promise<void> {
  beginGlobalBusy("Unlocking…");
  let plaintextJson: string;
  try {
    plaintextJson = await invoke<string>("unlock_payload", {
      encryptedDataB64: entry.lockedPayload!,
      keyFileContent: entry.lockedKeyFile!,
      password,
    });
  } finally {
    endGlobalBusy();
  }
  applyDecryptedPayload(entry, plaintextJson);
  entry.encrypted = false;
  entry.lockKeyMode = null;
  entry.lockedPayload = null;
  entry.lockedKeyFile = null;
  saveEntry(entry);
}

/** Locks `entry` in place (mutates it) and persists via saveEntry(). Returns whether it actually got locked (false = the user cancelled somewhere). This is the PERMANENT lock action (kebab menu "Lock"). */
export async function lockEntry(entry: Entry): Promise<boolean> {
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
    await performLock(entry, password, choice);
    if (choice === "app") setSessionAppPassword(password);
    pushToast({ title: "Locked", description: "This note is now locked." });
    return true;
  } catch (err) {
    console.error("lockFlow: lock_payload failed:", err);
    pushToast({ title: "Couldn't lock this", description: String(err), variant: "destructive" });
    return false;
  }
}

/** Unlocks `entry` in place (mutates it) and persists via saveEntry(). Returns whether it actually got unlocked (false = cancelled). Retries on a wrong password rather than giving up after one try. This is the PERMANENT unlock action (kebab menu "Unlock") — the lock is gone for good after this. To open a locked note/todo for viewing/editing without permanently removing its lock, use unlockForSession() instead. */
export async function unlockEntry(entry: Entry): Promise<boolean> {
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

    breadcrumb(`lockFlow: attempting permanent unlock for entry ${entry.id} (${entry.lockKeyMode} mode)`);
    try {
      const wasAppMode = entry.lockKeyMode === "app";
      await performUnlock(entry, password);
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

/**
 * Session-scoped unlock for the note/todo editor pages: decrypts
 * `entry` for viewing/editing (same crypto + prompt/retry flow as
 * unlockEntry()) but returns the password and lock mode that worked,
 * instead of discarding them, so the caller can silently re-lock via
 * relockSilently() when the user navigates away — without a second
 * password prompt. Returns null if the user cancelled the password
 * dialog.
 *
 * The entry itself looks identical to a permanent unlock the instant
 * this resolves (entry.encrypted === false, content readable/editable,
 * autosave persists it as plaintext exactly as it always has) — the
 * only difference is the caller now holds what it needs to put the lock
 * back. If the editor page is torn down by anything other than an
 * in-app navigation (the OS killing the process, force-closing the app)
 * before that happens, the entry is left unlocked at rest, same as it
 * would have been before this existed — there's no reliable way to
 * guarantee an async re-lock completes during a page/process teardown.
 */
export async function unlockForSession(entry: Entry): Promise<{ password: string; mode: LockKeyMode } | null> {
  if (!isTauri()) {
    pushToast({ title: "Unlock needs the app", description: "Encryption only works in the installed app, not this preview.", variant: "destructive" });
    return null;
  }
  if (!entry.encrypted || !entry.lockedPayload || !entry.lockedKeyFile) return null;

  const mode = entry.lockKeyMode as LockKeyMode;
  let password = mode === "app" ? sessionAppPassword.value : null;
  let error: string | null = null;

  while (true) {
    if (!password) {
      const title = mode === "app" ? "Enter your app password" : "Enter this note's password";
      const p = await askPassword(title, "", false, error);
      if (!p) return null;
      password = p;
    }

    breadcrumb(`lockFlow: attempting session unlock for entry ${entry.id} (${mode} mode)`);
    try {
      await performUnlock(entry, password);
      if (mode === "app") setSessionAppPassword(password);
      return { password, mode };
    } catch (err) {
      console.error("lockFlow: unlock_payload failed:", err);
      error = "Wrong password. Try again.";
      password = null;
    }
  }
}

/**
 * Re-locks `entry` using a password/mode already known from a prior
 * unlockForSession() call — no dialogs. Used by the note/todo editor
 * pages' onNavigate hook to put the lock back the moment the user
 * leaves, without asking them to type the password again. Returns
 * false (and leaves the entry as-is, still unlocked) if the crypto call
 * itself fails — this runs with no dialog to fall back to, so on
 * failure it pushes its own toast rather than throwing into onNavigate.
 */
export async function relockSilently(entry: Entry, password: string, mode: LockKeyMode): Promise<boolean> {
  if (!isTauri()) return false;
  breadcrumb(`lockFlow: silently re-locking entry ${entry.id} (${mode} mode) after session unlock`);
  try {
    await performLock(entry, password, mode);
    return true;
  } catch (err) {
    console.error("lockFlow: silent re-lock failed:", err);
    pushToast({ title: "Couldn't re-lock this", description: "It's left unlocked — open it and use the kebab menu's Lock action to secure it again.", variant: "destructive" });
    return false;
  }
}
