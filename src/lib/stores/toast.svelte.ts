// Minimal toast notification state — replaces the original app's
// useToast() hook. Svelte 5 runes state, not a classic store, so it can
// be imported and mutated directly from any .svelte or .svelte.ts file.

export interface ToastMsg {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export const toasts = $state<ToastMsg[]>([]);

export function pushToast(t: Omit<ToastMsg, "id">) {
  const id = crypto.randomUUID();
  toasts.push({ id, ...t });
  setTimeout(() => dismissToast(id), 4000);
}

export function dismissToast(id: string) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
}
