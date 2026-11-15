// Auto-lock policy: WHEN the app forgets the app password and puts a locked note
// that is open for editing back under its lock. Pure functions only (no Svelte, no
// DOM, no clock of their own) so every rule here can be tested with plain numbers.
//
// Two triggers, both meant to stop the same thing: someone else picking up an
// unlocked phone with MidNote still in memory and opening locked notes without ever
// being asked for the password.
//   1. AWAY: the app was in the background / the screen was off for longer than the
//      person's choice ("Ask for password again" in Settings -> Privacy & security).
//   2. IDLE: the app stayed in front but nothing was touched or typed for
//      IDLE_LOCK_MS (fixed, not a setting: the setting is about leaving the app).

export type AwayChoice = "now" | "1" | "5" | "15";

export interface AwayOption {
  value: AwayChoice;
  label: string;
  /** How long the app may be away before locked items need the password again. */
  ms: number;
}

export const AWAY_OPTIONS: readonly AwayOption[] = [
  { value: "now", label: "As soon as I leave", ms: 0 },
  { value: "1", label: "After 1 minute", ms: 60_000 },
  { value: "5", label: "After 5 minutes", ms: 5 * 60_000 },
  { value: "15", label: "After 15 minutes", ms: 15 * 60_000 },
];

/** Used until the person picks something: short enough to matter, long enough not to nag. */
export const DEFAULT_AWAY: AwayChoice = "1";

/** Nothing touched or typed for this long while the app is in front: lock. */
export const IDLE_LOCK_MS = 5 * 60_000;

/** A stored value that is not one of the choices (hand-edited, from an older build) falls back to the default. */
export function normalizeAway(raw: unknown): AwayChoice {
  return AWAY_OPTIONS.some((o) => o.value === raw) ? (raw as AwayChoice) : DEFAULT_AWAY;
}

export function awayLimitMs(choice: AwayChoice): number {
  return (AWAY_OPTIONS.find((o) => o.value === choice) ?? AWAY_OPTIONS[1]).ms;
}

/**
 * Has the app been away long enough? `hiddenAt` is when it went to the background
 * (null: it is not known to have been away at all). Equal counts as long enough, so
 * "as soon as I leave" (0 ms) always locks. A clock that went BACKWARDS while away
 * (negative elapsed time) cannot be trusted, so it counts as long enough too: when
 * in doubt, lock.
 */
export function isAwayTooLong(hiddenAt: number | null, now: number, choice: AwayChoice): boolean {
  if (hiddenAt === null) return false;
  const elapsed = now - hiddenAt;
  return elapsed < 0 || elapsed >= awayLimitMs(choice);
}

/** Has nothing been touched for long enough while the app is in front? (Same clock-went-backwards rule.) */
export function isIdleTooLong(lastActivityAt: number, now: number): boolean {
  const elapsed = now - lastActivityAt;
  return elapsed < 0 || elapsed >= IDLE_LOCK_MS;
}
