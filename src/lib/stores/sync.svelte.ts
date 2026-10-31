// Round C — sync, as the rest of the app sees it.
//
// A thin runes wrapper around online/syncEngine.ts (which holds all the rules) and
// online/syncRemote.ts (the server calls). This file owns the WHEN:
//   - always: when the person taps the cloud button / "Sync now"
//   - only with "Sync automatically" switched ON (Settings -> Account, OFF by default, so sync is
//     manual unless the person opts in):
//       - when the app opens (once storage is ready) and when it comes back to the foreground
//       - shortly after the person signs in
//       - about 20 seconds after the last edit, so a burst of typing is one push
// Automatic attempts back off with jitter after a failure; a tap always tries. There is no
// polling. Writes `syncStatus` only from handlers, timers and callbacks, never from an $effect.
// Even with auto sync off, deleting something forever is still RECORDED (so the next manual sync
// can tell the server); only the starting of a sync is manual.
import * as storage from "$lib/storage";
import { accountClient } from "$lib/stores/account.svelte";
import { refresh as refreshEntries } from "$lib/stores/entries.svelte";
import { sync as syncTags } from "$lib/stores/tags.svelte";
import { pushToast } from "$lib/stores/toast.svelte";
import { breadcrumb } from "$lib/debug/log.svelte";
import { cancelReminderSilently, syncReminderSilently } from "$lib/utils/reminders";
import { countPending, emptyState, nextAutoTime, parseState, runSync, type SyncDeps, type SyncResult, type SyncState } from "$lib/online/syncEngine";
import { RestSyncRemote } from "$lib/online/syncRemote";
import { describeResult, describeRestore } from "$lib/online/syncMessages";

const STATE_KEY = "midnote:sync-state";
const AUTO_KEY = "midnote:sync-auto";
const CHANGE_DEBOUNCE_MS = 20_000;
const MIN_AUTO_GAP_MS = 60_000;
const SIGN_IN_DELAY_MS = 1_500;

export const syncStatus = $state({
  running: false,
  lastSyncAt: null as string | null,
  /** What the last run came to; "none" before any. */
  outcome: "none" as "none" | "ok" | "partial" | "failed" | "account-mismatch",
  title: null as string | null,
  message: null as string | null,
  /** This phone's notes belong to another account: waiting for the person to choose. */
  mismatch: false,
  /** Changes made here that haven't gone up yet. */
  waiting: 0,
  /** Just signed in on a phone that has never synced: ask whether to bring the account's notes down. */
  offerRestore: false,
});

/** The person's choice: sync by itself (on open, on return, after edits) or only when asked. Off by default. */
export const syncPrefs = $state({ auto: false });

function loadAuto(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(AUTO_KEY) === "on";
  } catch {
    return false;
  }
}

/** Switch automatic sync on or off. Switching it on runs one sync now (when signed in); off drops anything waiting. */
export function setAutoSync(on: boolean): void {
  syncPrefs.auto = on;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    /* blocked or full: the choice holds until the app closes */
  }
  breadcrumb(`sync: automatic sync ${on ? "on" : "off"}`);
  if (!on) {
    stopSyncTimers();
    return;
  }
  if (signedInUser() && !running) void syncNow({ auto: true, force: true });
}

export type SyncOutcome = { status: "signed-out" | "skipped" | SyncResult["status"]; result?: SyncResult };

let state: SyncState = emptyState();
let applying = false;
let running: Promise<SyncOutcome> | null = null;
let failures = 0;
let nextAutoAt = 0;
let lastAttemptAt = 0;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let signInTimer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;
let started = false;
let lastSeenUser: string | null = null;
/** The run in flight should end with a toast (someone tapped for it, now or when it started). */
let toastWhenDone = false;

function loadState(): SyncState {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STATE_KEY);
    return raw ? parseState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

function saveState(s: SyncState): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the next run starts from what it can read */
  }
}

/** Counts what is waiting (cheap: one pass over the entries). */
export function refreshWaiting(): void {
  try {
    syncStatus.waiting = countPending(storage.loadEntries(), state);
  } catch {
    syncStatus.waiting = 0;
  }
}

function signedInUser(): string | null {
  return accountClient()?.current()?.user.id ?? null;
}

function scheduleAuto(ms: number): void {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    void syncNow({ auto: true });
  }, ms);
}

function onSaved(): void {
  if (applying) return;
  if (!syncPrefs.auto) return;
  if (!signedInUser()) return;
  scheduleAuto(CHANGE_DEBOUNCE_MS);
}

function onPurged(id: string, type: string): void {
  if (applying) return;
  // Only something the server knows about needs telling; a note that never left the phone doesn't.
  if (state.marks[id]) {
    state.purges[id] = { at: new Date().toISOString(), type };
    delete state.marks[id];
    saveState(state);
  }
  if (syncPrefs.auto && signedInUser()) scheduleAuto(CHANGE_DEBOUNCE_MS);
}

function onVisible(): void {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  if (!syncPrefs.auto) return;
  if (!signedInUser() || running) return;
  if (Date.now() - lastAttemptAt < MIN_AUTO_GAP_MS) return;
  void syncNow({ auto: true });
}

/** Call once at startup BEFORE storage loads: reads the saved state and listens for changes,
 *  so even the boot-time trash clean-up is noticed. Idempotent; never throws. */
export function initSync(): void {
  if (hooked) return;
  hooked = true;
  state = loadState();
  syncPrefs.auto = loadAuto();
  syncStatus.lastSyncAt = state.lastSyncAt;
  storage.onEntrySaved(onSaved);
  storage.onEntryPurged(onPurged);
  lastSeenUser = signedInUser();
  // Signing in (or into another account) starts a sync shortly after.
  accountClient()?.onChange(() => {
    const now = signedInUser();
    if (now === lastSeenUser) return;
    lastSeenUser = now;
    if (!now) return;
    if (!syncPrefs.auto) {
      // Manual mode: nothing syncs by itself. But a phone that has NEVER synced, just signed in, is most likely a new
      // phone (or a reinstall): offer, once, to bring the account's notes down. One tap; nothing is sent up.
      if (state.userId === null && state.lastSyncAt === null) {
        if (signInTimer) clearTimeout(signInTimer);
        signInTimer = setTimeout(() => {
          signInTimer = null;
          if (signedInUser() === now && !running) syncStatus.offerRestore = true;
        }, SIGN_IN_DELAY_MS);
      }
      return;
    }
    if (signInTimer) clearTimeout(signInTimer);
    signInTimer = setTimeout(() => {
      signInTimer = null;
      void syncNow({ auto: true, force: true });
    }, SIGN_IN_DELAY_MS);
  });
}

/** Call once after storage is ready: the first sync of the session, and foreground syncs. */
export function startSync(): void {
  if (started) return;
  started = true;
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  refreshWaiting();
  if (syncPrefs.auto && signedInUser()) void syncNow({ auto: true, force: true });
}

function scopeOf(type: string): "notes" | "todos" | "boards" | null {
  return type === "regular" ? "notes" : type === "todo" ? "todos" : type === "board" ? "boards" : null;
}

/** After entries arrived from the server: tags, reminders. Best effort, never throws. */
function afterPull(r: SyncResult): void {
  try {
    for (const id of r.appliedIds) {
      const e = storage.getEntry(id);
      if (!e) continue;
      const scope = scopeOf(e.type);
      if (scope) for (const tag of e.tags) storage.addKnownTag(scope, tag);
      if (e.reminderAt && !e.deletedAt) void syncReminderSilently(e).catch(() => {});
      else cancelReminderSilently(id);
    }
    for (const id of r.removedIds) cancelReminderSilently(id);
    refreshEntries();
    syncTags();
  } catch (err) {
    breadcrumb(`sync: after-pull housekeeping failed (${err instanceof Error ? err.message : "error"})`);
  }
}

export interface SyncNowOptions {
  /** Started by the app, not by a tap: honours the back-off, stays quiet. */
  auto?: boolean;
  /** An automatic start that must not wait for the back-off or the minimum gap. */
  force?: boolean;
  /** Take this phone's notes into the signed-in account (the person chose to). */
  adopt?: boolean;
  /** Tell the person how it went with a toast. */
  toast?: boolean;
  /** Only bring things down; send nothing (Restore from cloud). */
  pullOnly?: boolean;
  /** This is a Restore from cloud: it is worded as one. */
  restore?: boolean;
}

export function syncNow(opts: SyncNowOptions = {}): Promise<SyncOutcome> {
  if (running) {
    // A tap while the app's own sync is already running joins it, and still gets told how it went.
    if (opts.toast) toastWhenDone = true;
    return running;
  }
  const client = accountClient();
  const session = client?.current() ?? null;
  if (!client || !session) return Promise.resolve({ status: "signed-out" });
  // An automatic start only ever happens with the switch on (a timer set before it went off must not fire).
  if (opts.auto && !syncPrefs.auto) return Promise.resolve({ status: "skipped" });
  if (opts.auto && !opts.force && Date.now() < nextAutoAt) return Promise.resolve({ status: "skipped" });
  if (opts.auto && state.userId && state.userId !== session.user.id && !opts.adopt) {
    // Never merge another account's notes automatically: wait for the person.
    syncStatus.mismatch = true;
    syncStatus.outcome = "account-mismatch";
    return Promise.resolve({ status: "account-mismatch" });
  }
  const userId = session.user.id;
  toastWhenDone = opts.toast === true;
  // Whatever was waiting out its pause is part of THIS run (it collects every change made so
  // far), so the pause is over. Edits made while it runs start a new one.
  if (changeTimer) {
    clearTimeout(changeTimer);
    changeTimer = null;
  }
  syncStatus.running = true;
  lastAttemptAt = Date.now();
  breadcrumb("sync: started");
  const deps: SyncDeps = {
    remote: new RestSyncRemote((path, init) => client.request(path, init)),
    local: {
      list: () => storage.loadEntries(),
      upsert: (entry) => {
        applying = true;
        try {
          return storage.upsertEntry(entry, { touch: false });
        } finally {
          applying = false;
        }
      },
      remove: (id) => {
        applying = true;
        try {
          storage.deleteEntry(id);
        } finally {
          applying = false;
        }
      },
    },
    normalize: storage.normalizeEntry,
    saveState,
    now: () => Date.now(),
    userId,
    shouldStop: () => signedInUser() !== userId,
  };
  running = (async (): Promise<SyncOutcome> => {
    let result: SyncResult;
    try {
      result = await runSync(deps, state, { adopt: opts.adopt, pullOnly: opts.pullOnly });
    } catch (e) {
      // runSync reports its own failures; this is a bug in it. Say so, don't hang the button.
      result = { status: "failed", pushed: 0, pushedPurges: 0, pulled: 0, removed: 0, unchanged: 0, skipped: 0, heldBack: 0, rejected: [], quota: false, changedLocal: false, appliedIds: [], removedIds: [], error: { kind: "server", message: e instanceof Error ? e.message.slice(0, 80) : "error" } };
    }
    if (result.changedLocal) afterPull(result);
    const d = opts.restore ? describeRestore(result) : describeResult(result);
    syncStatus.title = d.title;
    syncStatus.message = d.description;
    syncStatus.mismatch = result.status === "account-mismatch";
    syncStatus.outcome = result.status;
    if (result.status === "ok" || result.status === "partial") {
      failures = 0;
      nextAutoAt = 0;
      syncStatus.lastSyncAt = state.lastSyncAt;
    } else if (result.status === "failed") {
      failures++;
      const kind = result.error?.kind;
      // Signed out: nothing to retry until a sign-in. Everything else backs off with jitter.
      nextAutoAt = nextAutoTime(kind, failures, Date.now(), Math.random);
      breadcrumb(`sync: failed (${kind}) next try in ${Math.round((nextAutoAt - Date.now()) / 1000)}s`);
    }
    refreshWaiting();
    if (toastWhenDone) pushToast({ title: d.title, description: d.description });
    breadcrumb(`sync: ${result.status} sent ${result.pushed}+${result.pushedPurges} got ${result.pulled}+${result.removed}`);
    return { status: result.status, result };
  })().finally(() => {
    running = null;
    syncStatus.running = false;
  });
  return running;
}

/**
 * Restore from cloud: read EVERYTHING the account has from the start (not only what is new since the last sync) and bring
 * down whatever is missing here or newer there. Nothing is sent, and nothing on this phone is deleted or replaced by an
 * older copy (the newer one always wins, as in a sync). Things deleted forever are gone for good: the server keeps only
 * the latest version of each item, so this cannot go back in time.
 */
export function restoreFromCloud(): Promise<SyncOutcome> {
  if (running) {
    toastWhenDone = true;
    return running;
  }
  const me = signedInUser();
  // Only this account's own record is reset: another account's marks are never touched (a mismatch is still the person's call).
  if (me && (state.userId === null || state.userId === me)) {
    state.cursor = null;
    saveState(state);
  }
  breadcrumb("sync: restore from cloud (full re-read, nothing sent)");
  syncStatus.offerRestore = false;
  return syncNow({ pullOnly: true, restore: true, toast: true });
}

/** The person chose to take this phone's notes into the account they're signed in to now. */
export function adoptThisAccount(): Promise<SyncOutcome> {
  return syncNow({ adopt: true, toast: true });
}

/** For tests and sign-out: forget the in-memory timers. */
export function stopSyncTimers(): void {
  if (changeTimer) clearTimeout(changeTimer);
  if (signInTimer) clearTimeout(signInTimer);
  changeTimer = null;
  signInTimer = null;
}
