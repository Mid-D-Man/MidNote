// Minimal toast notification state — replaces the original app's
// useToast() hook. Svelte 5 runes state, not a classic store, so it can
// be imported and mutated directly from any .svelte or .svelte.ts file.

export interface ToastMsg {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
  // Round 35: an optional button on the toast ("Undo"). It runs once, then
  // the toast goes away.
  action?: { label: string; run: () => void };
  durationMs?: number;
}

import { untrack } from "svelte";

export const toasts = $state<ToastMsg[]>([]);

export function pushToast(t: Omit<ToastMsg, "id">): string {
  const id = crypto.randomUUID();
  toasts.push({ id, ...t });
  setTimeout(() => dismissToast(id), t.durationMs ?? 4000);
  return id;
}

export function dismissToast(id: string) {
  // Same defensive fix as the other stores — findIndex reads `toasts`,
  // splice writes it. Currently only reached via setTimeout (untracked)
  // or direct event-handler calls, but closed here too so a future
  // effect-driven toast (e.g. "show a toast when a background sync
  // fails") can't reintroduce this bug class.
  untrack(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  });
                             }
