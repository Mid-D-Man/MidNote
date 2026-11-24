// A single app-wide "something slow is happening, hold on" indicator —
// driven by lockFlow.ts's performLock/performUnlock (Argon2id is a
// deliberately memory-hard KDF; see crypto.rs's kdf_*, genuinely slow
// enough on a phone to need more than a small per-button spinner) and by
// runBusy() below, which is what the backup, restore and other slow
// screens use: runBusy("Restoring…", () => doTheWork()). A
// counter, not a boolean: no two callers currently overlap, but this
// way a second concurrent caller (if that ever happens) can't
// prematurely clear the first one's spinner by finishing early.
let count = $state(0);
let label = $state("");

export const globalBusy = {
  get active() {
    return count > 0;
  },
  get label() {
    return label;
  },
};

export function beginGlobalBusy(text: string) {
  label = text;
  count += 1;
}

export function endGlobalBusy() {
  count = Math.max(0, count - 1);
}

/** Change the words under the spinner while it is showing (e.g. "Restoring… 3 / 40"). Does nothing when nothing is busy. */
export function setGlobalBusyLabel(text: string) {
  if (count > 0) label = text;
}

/**
 * Show the busy spinner while `work` runs, and always take it down afterwards (even if `work` throws). The spinner only appears
 * after `delayMs` (default 250), so something that finishes at once doesn't flash it; pass 0 to show it right away.
 */
export async function runBusy<T>(text: string, work: () => Promise<T>, opts: { delayMs?: number } = {}): Promise<T> {
  const delay = opts.delayMs ?? 250;
  let shown = false;
  const show = () => {
    shown = true;
    beginGlobalBusy(text);
  };
  const timer = delay > 0 ? setTimeout(show, delay) : null;
  if (delay <= 0) show();
  try {
    return await work();
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (shown) endGlobalBusy();
  }
}
