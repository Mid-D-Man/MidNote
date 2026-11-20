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
//
// PHONE UNLOCK (optional, off by default, per phone): when it is on, going away does not FORGET the password, it GATES it: the
// password stays in memory but nothing can use it until the phone's own security (fingerprint, face, or the PIN / pattern /
// password of the phone) says it is the person (utils/phoneAuth.ts). Forget, turning the setting off, or closing the app for good
// still forgets it, and then it has to be typed once. Still never written anywhere.
import { DEFAULT_AWAY, normalizeAway, type AwayChoice } from "$lib/utils/autoLockPolicy";

export const sessionAppPassword = $state<{ value: string | null }>({ value: null });

// The gated copy. A plain variable on purpose: the screens only need to know THAT there is one (heldAppPassword.present), never what it is.
let held: string | null = null;
export const heldAppPassword = $state<{ present: boolean }>({ present: false });

/** The password was typed (or is being used again): it is the session password, and no gated copy is kept next to it. */
export function setSessionAppPassword(password: string | null) {
  sessionAppPassword.value = password;
  held = null;
  heldAppPassword.present = false;
}

/** Forget the app password completely, gated copy included (the next app-locked unlock asks again). Safe to call when none is set. */
export function forgetSessionAppPassword() {
  sessionAppPassword.value = null;
  held = null;
  heldAppPassword.present = false;
}

/**
 * Going away: with phone unlock ON the session password is kept but gated, otherwise it is forgotten like before. Whatever was
 * already gated stays gated.
 */
export function gateSessionAppPassword() {
  if (phoneUnlock.on && sessionAppPassword.value !== null) {
    held = sessionAppPassword.value;
    heldAppPassword.present = true;
  } else if (!phoneUnlock.on) {
    held = null;
    heldAppPassword.present = false;
  }
  sessionAppPassword.value = null;
}

/** The phone said it is the person: the gated password becomes the session password again. Returns it (null when there was none). */
export function releaseHeldAppPassword(): string | null {
  if (held === null) return null;
  sessionAppPassword.value = held;
  held = null;
  heldAppPassword.present = false;
  return sessionAppPassword.value;
}

// "Unlock with phone security" — a per-phone choice (never synced), OFF until the person turns it on and proves it works.
const PHONE_KEY = "midnote:phone-unlock";

function readPhoneUnlock(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(PHONE_KEY) === "on";
  } catch {
    return false;
  }
}

export const phoneUnlock = $state<{ on: boolean }>({ on: readPhoneUnlock() });

export function setPhoneUnlock(on: boolean) {
  phoneUnlock.on = on;
  try {
    if (typeof localStorage !== "undefined") {
      if (on) localStorage.setItem(PHONE_KEY, "on");
      else localStorage.removeItem(PHONE_KEY);
    }
  } catch {
    // Storage full / blocked: the choice still holds for this session.
  }
  if (!on) {
    held = null;
    heldAppPassword.present = false;
  }
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
