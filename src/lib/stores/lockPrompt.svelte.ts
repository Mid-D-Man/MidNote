// Promise-based request/response bridge to ONE globally-mounted dialog
// (components/shared/LockPrompt/LockPrompt.svelte, mounted once in
// +layout.svelte) — same "one global renderer reads a shared store"
// shape as toast.svelte.ts/Toast.svelte, just request/response instead
// of fire-and-forget. This is what lets utils/lockFlow.ts read as plain
// linear async code (`const choice = await askLockChoice(); ...`)
// instead of every call site needing its own dialog markup and open/
// close state wired by hand.
export type LockChoice = "app" | "custom";

type LockPromptRequest =
  | { kind: "choice"; resolve: (choice: LockChoice | null) => void }
  | { kind: "password"; title: string; description: string; confirm: boolean; error: string | null; resolve: (password: string | null) => void };

export const lockPromptRequest = $state<{ value: LockPromptRequest | null }>({ value: null });

export function askLockChoice(): Promise<LockChoice | null> {
  return new Promise((resolve) => {
    lockPromptRequest.value = {
      kind: "choice",
      resolve: (choice) => {
        lockPromptRequest.value = null;
        resolve(choice);
      },
    };
  });
}

// `confirm: true` shows a second "confirm password" field and only
// resolves once both match — used when a password is being SET (app
// password's first use, or any custom password) rather than re-entered
// to unlock something already locked with a known value.
export function askPassword(title: string, description: string, confirm: boolean, error: string | null = null): Promise<string | null> {
  return new Promise((resolve) => {
    lockPromptRequest.value = {
      kind: "password",
      title,
      description,
      confirm,
      error,
      resolve: (password) => {
        lockPromptRequest.value = null;
        resolve(password);
      },
    };
  });
}
