// The "app password" for Lock's default (non-custom) mode — held ONLY
// in memory for the current session, on purpose. Never written to
// localStorage, never sent anywhere except as an argument to the
// lock_payload/unlock_payload Tauri commands at the moment it's needed.
//
// There's deliberately no separate "set your app password" flow with
// its own validation: the app password only becomes a real, checkable
// thing once at least one entry has actually been locked with it. So
// the first time in a session you lock or unlock an "app"-mode entry
// without one already in memory, whatever you type in that moment
// BECOMES the app password for the rest of the session — if it's later
// wrong for some other app-mode entry, that decrypt attempt fails and
// you're prompted again. This means the app never needs to store (or
// even hash) the password anywhere persistent — real DixScript
// decryption failing IS the "wrong password" check, nothing else is
// needed. Restarting the app forgets it, same as it never remembers
// itself in the first place; that's intentional, not a gap — see
// utils/lockFlow.ts's header comment for the fuller reasoning.
export const sessionAppPassword = $state<{ value: string | null }>({ value: null });

export function setSessionAppPassword(password: string | null) {
  sessionAppPassword.value = password;
}
