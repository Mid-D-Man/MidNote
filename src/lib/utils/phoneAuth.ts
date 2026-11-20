// The phone's own security prompt (fingerprint, face, or the PIN / pattern / password the phone is unlocked with), used to
// open locked notes without typing the app password again. It only ASKS the phone "is this the person?": the app password itself
// stays in memory (stores/lockSession.svelte.ts) and nothing secret is stored here or handed to the phone.
//
// The native side is the official Tauri biometric plugin (mobile only). It is called raw, like the other Android plugins
// here, so there is no extra npm package. Where the plugin is not part of the build (the browser, desktop) `supported()` is
// false and the settings row is not shown. Tests replace the whole thing with globalThis.__midnotePhoneAuth.
import { invoke, isTauri } from "@tauri-apps/api/core";

export type PhoneAuthFail = "cancelled" | "no-lock" | "locked-out" | "failed";
export type PhoneAuthResult = { ok: true } | { ok: false; why: PhoneAuthFail };

export interface PhoneAuthBackend {
  /** Does this build have the phone's security prompt at all? */
  supported(): Promise<boolean>;
  /** Show the prompt. `reason` is the line the phone shows with it. */
  authenticate(reason: string): Promise<PhoneAuthResult>;
}

/** What went wrong, from whatever the plugin rejected with (a string, or an object with a code or message). */
export function whyFailed(e: unknown): PhoneAuthFail {
  let text = "";
  if (typeof e === "string") text = e;
  else if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    text = `${typeof o.code === "string" ? o.code : ""} ${typeof o.message === "string" ? o.message : ""}`;
  } else text = String(e ?? "");
  const t = text.toLowerCase();
  if (t.includes("usercancel") || t.includes("systemcancel") || t.includes("cancel")) return "cancelled";
  if (t.includes("passcodenotset") || t.includes("notenrolled") || t.includes("notavailable") || t.includes("no_device_credential")) return "no-lock";
  if (t.includes("lockout")) return "locked-out";
  return "failed";
}

const realBackend: PhoneAuthBackend = {
  async supported() {
    if (!isTauri()) return false;
    try {
      await invoke("plugin:biometric|status");
      return true;
    } catch {
      return false;
    }
  },
  async authenticate(reason) {
    try {
      await invoke("plugin:biometric|authenticate", {
        reason,
        allowDeviceCredential: true,
        title: "MidNote",
        subtitle: "Confirm it's you",
        confirmationRequired: false,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, why: whyFailed(e) };
    }
  },
};

export function getPhoneAuth(): PhoneAuthBackend {
  const seam = (globalThis as { __midnotePhoneAuth?: PhoneAuthBackend }).__midnotePhoneAuth;
  return seam ?? realBackend;
}

// While the phone's prompt is up the app looks "hidden" to the page: that must not count as the person going away, or the
// password would be gated again the instant it was released. utils/autoLock.ts asks phoneAuthPaused() for each hide event.
// The window after the prompt is kept very short on purpose: someone who confirms and leaves at once must still start the timer.
const QUIET_AFTER_MS = 400;
let busy = false;
let quietUntil = 0;
let inFlight: Promise<PhoneAuthResult> | null = null;

export function phoneAuthPaused(now: number = Date.now()): boolean {
  return busy || now < quietUntil;
}

/** Ask the phone. Callers that ask while a prompt is already up share that one prompt (opening a note can ask twice). */
export function confirmItsYou(reason: string): Promise<PhoneAuthResult> {
  if (inFlight) return inFlight;
  busy = true;
  const run: Promise<PhoneAuthResult> = getPhoneAuth()
    .authenticate(reason)
    .catch((): PhoneAuthResult => ({ ok: false, why: "failed" }))
    .then((r) => {
      busy = false;
      quietUntil = Date.now() + QUIET_AFTER_MS;
      inFlight = null;
      return r;
    });
  inFlight = run;
  return run;
}
