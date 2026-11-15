// The "app password" for Lock's default (non-custom) mode — held ONLY
// in memory, on purpose. Never written to localStorage, never sent anywhere
// except as an argument to the lock_payload/unlock_payload Tauri commands at
// the moment it's needed.
//
// There's deliberately no separate "set your app password" step with its own
// stored check value: the app password only becomes a real, checkable thing once
// at least one entry has actually been locked with it, and real DixScript
// decryption failing IS the "wrong password" check (see lockFlow.ts, which also
// uses an already-locked entry to verify what you type before it can become a
// SECOND, different app password).
//
// HOW LONG IT IS REMEMBERED (reworked): it used to be remembered until the
// process died, which on a phone can be days — so after the first password every
// locked note opened with no question at all. Now utils/autoLock.ts forgets it
// (and puts any open locked note back under its lock) when the app has been away
// longer than the person's "Ask for password again" choice, after a few idle
// minutes in front, or on "Lock now". Restarting the app forgets it too.
import { DEFAULT_AWAY, normalizeAway, type AwayChoice } from "$lib/utils/autoLockPolicy";

export const sessionAppPassword = $state<{ value: string | null }>({ value: null });

export function setSessionAppPassword(password: string | null) {
  sessionAppPassword.value = password;
}

/** Forget the app password (the next app-locked unlock asks again). Safe to call when none is set. */
export function forgetSessionAppPassword() {
  sessionAppPassword.value = null;
}

// "Ask for password again" — how long the app may be away before locked items
// need the password again. Local to this phone on purpose (never synced): how
// strict to be is a per-device decision.
const AWAY_KEY = "midnote:auto-lock";

function readAway(): AwayChoice {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_AWAY;
    return normalizeAway(localStorage.getItem(AWAY_KEY));
  } catch {
    return DEFAULT_AWAY;
  }
}

export const autoLockAway = $state<{ value: AwayChoice }>({ value: readAway() });

export function setAutoLockAway(choice: AwayChoice) {
  autoLockAway.value = normalizeAway(choice);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(AWAY_KEY, autoLockAway.value);
  } catch {
    // Storage full / blocked: the choice still holds for this session.
  }
}
