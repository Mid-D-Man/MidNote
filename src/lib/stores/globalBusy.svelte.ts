// A single app-wide "something slow is happening, hold on" indicator —
// currently only driven by lockFlow.ts's performLock/performUnlock
// (Argon2id is a deliberately memory-hard KDF; see crypto.rs's kdf_*
// fields — genuinely slow enough on a phone to need more than a small
// per-button spinner), nothing else in the app triggers this today. A
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
