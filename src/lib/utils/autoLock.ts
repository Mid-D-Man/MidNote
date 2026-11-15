// Auto-lock: calls lockNow() (utils/lockFlow.ts: forget the app password + put every
// open locked note/todo/board back under its lock) when the app has been away or
// idle too long. The rules themselves live in autoLockPolicy.ts as plain functions.
//
// Two layers, because a phone can freeze the page while the app is in the background:
//   - a timer started when the app goes to the background (fires if the page is
//     still running, so the re-lock happens while the person is away), AND
//   - a timestamp check when the app comes back (covers a frozen page whose timer
//     never fired).
// "As soon as I leave the app" locks in the visibilitychange handler itself, with no
// timer. Idle in front is a slow interval over the time of the last touch/keystroke.
//
// The decision logic is the AutoLockWatcher class (every method takes the time as an
// argument, so tests drive it with plain numbers); startAutoLock() is the thin DOM
// wiring around it. Never throws into the page: a failed lock is reported by
// relockSilently's own toast.
import { isAwayTooLong, isIdleTooLong, awayLimitMs, type AwayChoice } from "$lib/utils/autoLockPolicy";

export interface AutoLockDeps {
  /** The person's current "Ask for password again" choice (read each time, so a change applies at once). */
  getAway: () => AwayChoice;
  /** Is there anything to lock (a remembered password or an open locked note)? Avoids pointless work. */
  hasSecrets: () => boolean;
  /** Lock for real (lockFlow.lockNow). */
  lock: () => Promise<unknown>;
  /** Timer seam for tests. */
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export class AutoLockWatcher {
  private hiddenAt: number | null = null;
  private lastActivityAt: number;
  private awayTimer: unknown = null;

  constructor(
    private readonly deps: AutoLockDeps,
    now: number,
  ) {
    this.lastActivityAt = now;
  }

  private fire() {
    if (!this.deps.hasSecrets()) return;
    try {
      void Promise.resolve(this.deps.lock()).catch(() => {});
    } catch {
      // Never throws into the page (a failed lock reports itself through its own toast).
    }
  }

  private cancelAwayTimer() {
    if (this.awayTimer !== null) this.deps.clearTimer(this.awayTimer);
    this.awayTimer = null;
  }

  /** The app went to the background / the screen turned off. */
  onHidden(now: number) {
    this.cancelAwayTimer();
    this.hiddenAt = now;
    const limit = awayLimitMs(this.deps.getAway());
    if (limit === 0) {
      this.fire();
      return;
    }
    this.awayTimer = this.deps.setTimer(() => {
      this.awayTimer = null;
      this.fire();
    }, limit);
  }

  /** The app came back to the front. */
  onVisible(now: number) {
    this.cancelAwayTimer();
    const tooLong = isAwayTooLong(this.hiddenAt, now, this.deps.getAway());
    this.hiddenAt = null;
    this.lastActivityAt = now; // coming back counts as being active (and restarts the idle count)
    if (tooLong) this.fire();
  }

  /** A touch, key press or scroll in the app. */
  onActivity(now: number) {
    this.lastActivityAt = now;
  }

  /** Called every few seconds while the app is in front. */
  checkIdle(now: number) {
    if (this.hiddenAt !== null) return; // away: the away rules apply, not the idle ones
    if (!isIdleTooLong(this.lastActivityAt, now)) return;
    this.lastActivityAt = now; // one lock per idle stretch, not one every check
    this.fire();
  }

  dispose() {
    this.cancelAwayTimer();
  }
}

const IDLE_CHECK_EVERY_MS = 15_000;
const ACTIVITY_EVENTS = ["pointerdown", "touchstart", "keydown", "input", "scroll", "wheel"] as const;

/**
 * Starts watching the page. Returns the function that stops it. Called once from the
 * root layout, which passes the real setting, lockNow() and the browser's timers.
 */
export function startAutoLock(deps: AutoLockDeps): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  const watcher = new AutoLockWatcher(deps, Date.now());

  const onVisibility = () => {
    if (document.visibilityState === "hidden") watcher.onHidden(Date.now());
    else watcher.onVisible(Date.now());
  };
  const onActivity = () => watcher.onActivity(Date.now());

  document.addEventListener("visibilitychange", onVisibility);
  // Capture + passive: sees every touch/scroll in the app without ever delaying one.
  for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });
  const idleTimer = window.setInterval(() => watcher.checkIdle(Date.now()), IDLE_CHECK_EVERY_MS);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true } as EventListenerOptions);
    window.clearInterval(idleTimer);
    watcher.dispose();
  };
}
