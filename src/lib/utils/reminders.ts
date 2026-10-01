// Reminders (round 31): one reminder per note / todo / board, delivered as an
// Android notification at the chosen date and time — the FlyNote
// "Set reminder" idea.
//
// HOW IT'S DELIVERED. The official tauri-plugin-notification, which on
// Android schedules through AlarmManager. Its source (v2.5.0) was read, and
// these facts are taken from it, not assumed:
//   - scheduling a time in the PAST is silently dropped (it logs an error
//     natively and returns success to JS) — so the time is validated here
//     first (MIN_LEAD_MS);
//   - with `allowWhileIdle` it uses setExactAndAllowWhileIdle when the app
//     may schedule exact alarms and setAndAllowWhileIdle (inexact) otherwise,
//     so a reminder is never lost, only possibly a few minutes late if exact
//     alarms aren't permitted. The build declares USE_EXACT_ALARM (and
//     SCHEDULE_EXACT_ALARM up to Android 12) in the manifest to get exactness
//     with no permission screen — see .github/workflows/build-andriod.yml;
//   - rescheduling with the same notification id replaces the old alarm
//     (FLAG_CANCEL_CURRENT on a PendingIntent keyed by the id);
//   - THE TWO SCHEDULING COMMANDS ARE NOT EQUAL (learned from the round 31
//     device test, then confirmed in the Kotlin source). `notify` (Kotlin
//     `show`) sets the alarm but never saves the notification: it can't be
//     listed by `get_pending`, the boot receiver (which restores alarms from
//     that saved copy) can't restore it, and the plugin never fills in
//     `sourceJson`, so a tap reaches JS with NO notification/extra. `batch`
//     does save it — keyed by id, as the `sourceJson` string, which is
//     exactly what the plugin reads back for boot restore, get_pending and
//     the tap payload. The plugin never builds `sourceJson` itself, so we
//     send it: the notification's own JSON. Hence schedule() uses `batch`
//     with `sourceJson` and falls back to `notify` (alarm only) if the
//     device rejects that;
//   - the old post-schedule `get_pending` check was REMOVED: after `notify`
//     the list is always empty, so it reported "Android didn't accept that
//     reminder" for an alarm that was in fact set and went off;
//   - tapping the notification fires a plugin event carrying the saved
//     notification (`sourceJson`), including the `extra` object we attach
//     (entry id + type), which is how a tap opens the note. Reminders set
//     before this fix (via `notify`) carry none: tapping those only opens
//     the app.
//
// WHY `invoke` AND NOT THE @tauri-apps/plugin-notification PACKAGE. The
// package is a thin wrapper around these same invoke() calls (its source was
// read too), and using invoke directly keeps package.json / package-lock.json
// untouched — a root-level file the delivery pipeline can't safely replace.
// The exact command names and payload shapes are checked against the
// plugin's Rust serde model in the round 31 tests.
//
// Everything that needs no device (ids, time parsing, validation, formatting,
// the notification payload, the set/clear flows against a backend) is written
// against a small `ReminderBackend` interface, so it runs in tests with a
// fake. The real backend at the bottom is the only part that touches Tauri.

import { invoke, addPluginListener, isTauri } from "@tauri-apps/api/core";
import type { Entry } from "$lib/types/entry";

export type PermissionState = "granted" | "denied" | "prompt";

/** The slice of an entry reminders care about (a Note, Todo or Board all have it). */
export type ReminderSubject = Pick<Entry, "id" | "type" | "title" | "encrypted" | "reminderAt">;

export const REMINDER_CHANNEL_ID = "reminders";
/** Nothing closer than this is accepted: the alarm must be comfortably in the future. */
export const MIN_LEAD_MS = 30_000;

// ---- ids ----------------------------------------------------------------

/**
 * A stable positive 31-bit id for an entry's notification (FNV-1a). Android
 * notification ids are ints, and deriving it from the entry id means a
 * reminder can always be cancelled from the entry alone — nothing extra has
 * to be stored or can drift out of sync.
 */
export function reminderNotificationId(entryId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < entryId.length; i++) {
    h ^= entryId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const id = h & 0x7fffffff;
  return id === 0 ? 1 : id;
}

// ---- time ----------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** <input type="date"> value (local): "2026-09-30". */
export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** <input type="time"> value (local): "14:05". */
export function toTimeInputValue(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A local Date from the two input values, or null when either is missing/invalid. */
export function combineDateTime(dateStr: string, timeStr: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  const tm = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(timeStr || "");
  if (!dm || !tm) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  const out = new Date(y, mo - 1, d, h, mi, 0, 0);
  // new Date() rolls 31 Feb over into March; reject anything that didn't
  // come back as the same calendar date / clock time.
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d || out.getHours() !== h || out.getMinutes() !== mi) return null;
  return out;
}

/** null when `at` is acceptable, else a short message for the user. */
export function validateReminderTime(at: Date | null, now: Date = new Date()): string | null {
  if (!at || Number.isNaN(at.getTime())) return "Pick a date and a time.";
  if (at.getTime() - now.getTime() < MIN_LEAD_MS) return "Pick a time in the future.";
  return null;
}

/** The next full hour, or the one after if that's under 15 minutes away. */
export function defaultReminderTime(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  if (d.getTime() - now.getTime() < 15 * 60_000) d.setHours(d.getHours() + 1);
  return d;
}

export interface ReminderPreset {
  label: string;
  at: Date;
}

/** Quick picks that are actually in the future. */
export function reminderPresets(now: Date = new Date()): ReminderPreset[] {
  const out: ReminderPreset[] = [];
  const inOneHour = new Date(now.getTime() + 60 * 60_000);
  inOneHour.setSeconds(0, 0);
  out.push({ label: "In 1 hour", at: inOneHour });
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() - now.getTime() >= 15 * 60_000) out.push({ label: "Tonight 8 PM", at: tonight });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  out.push({ label: "Tomorrow 9 AM", at: tomorrow });
  return out;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today, 14:05" / "Tomorrow, 09:00" / "Wed 7 Oct, 14:05" / "Wed 7 Oct 2027, 14:05". */
export function formatReminderWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const clock = toTimeInputValue(d);
  if (sameDay(d, now)) return `Today, ${clock}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return `Tomorrow, ${clock}`;
  const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${clock}`;
}

/** "in 5 min", "in 2 h 5 min", "in 3 days" — for a future time. */
export function formatCountdown(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `in ${hours} h ${mins % 60} min` : `in ${hours} h`;
  const days = Math.floor(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/** True when the entry has a reminder that hasn't gone off yet. */
export function isActiveReminder(reminderAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!reminderAt) return false;
  const t = Date.parse(reminderAt);
  return Number.isFinite(t) && t > now.getTime();
}

// ---- notification payload ------------------------------------------------

export interface ReminderPayload {
  id: number;
  channelId: string;
  title: string;
  body: string;
  autoCancel: boolean;
  schedule: { at: { date: string; repeating: false; allowWhileIdle: true } };
  extra: { entryId: string; entryType: string };
}

/**
 * What the lock screen gets to see. A locked entry's title is private, so
 * it's replaced with a generic line (and lockEntry() reschedules an existing
 * reminder so the stored text matches — see syncReminderSilently).
 */
export function buildReminderPayload(entry: ReminderSubject, at: Date): ReminderPayload {
  const title = entry.encrypted ? "Locked note" : entry.title.trim() || "Untitled";
  return {
    id: reminderNotificationId(entry.id),
    channelId: REMINDER_CHANNEL_ID,
    title,
    body: "Reminder \u00b7 tap to open",
    autoCancel: true,
    schedule: { at: { date: at.toISOString(), repeating: false, allowWhileIdle: true } },
    extra: { entryId: entry.id, entryType: entry.type },
  };
}

const ROUTE_FOR_TYPE: Record<string, string> = { regular: "note", todo: "todo", board: "board" };

/** Where a tapped reminder should go, or null if its extra data is unusable. */
export function reminderTapPath(extra: unknown): string | null {
  if (!extra || typeof extra !== "object") return null;
  const { entryId, entryType } = extra as Record<string, unknown>;
  if (typeof entryId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(entryId)) return null;
  const route = typeof entryType === "string" ? ROUTE_FOR_TYPE[entryType] : undefined;
  return route ? `/${route}/${entryId}` : null;
}

// ---- backend interface ---------------------------------------------------

export interface ReminderBackend {
  supported(): boolean;
  permissionState(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  createChannel(): Promise<void>;
  /** Resolves with a short note on how it was scheduled (for the debug log), or nothing. */
  schedule(payload: ReminderPayload): Promise<string | void>;
  cancel(id: number): Promise<void>;
  onTap(handler: (extra: unknown) => void): Promise<() => void>;
}

// ---- operations ----------------------------------------------------------

export type SetReminderResult =
  | { ok: true; at: string; route?: string }
  | { ok: false; reason: "unsupported" | "past" | "permission" | "failed"; message: string };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Schedules (or replaces) the reminder. Does NOT touch entry data — the
 * caller saves `reminderAt` only when this says ok, so data and alarm can't
 * disagree. Order matters: validate, permission, channel, cancel the old
 * alarm, schedule. (No "is it pending?" lookup afterwards: the plugin's
 * pending list can't be trusted — see the header.)
 */
export async function setReminder(
  entry: ReminderSubject,
  at: Date,
  backend: ReminderBackend = getBackend(),
  now: Date = new Date()
): Promise<SetReminderResult> {
  if (!backend.supported()) {
    return { ok: false, reason: "unsupported", message: "Reminders work in the Android app, not in this preview." };
  }
  const bad = validateReminderTime(at, now);
  if (bad) return { ok: false, reason: "past", message: bad };

  try {
    let state = await backend.permissionState();
    if (state !== "granted") state = await backend.requestPermission();
    if (state !== "granted") {
      return {
        ok: false,
        reason: "permission",
        message: "Notifications are turned off for MidNote. Turn them on in Android Settings \u203a Apps \u203a MidNote \u203a Notifications, then try again.",
      };
    }
    await backend.createChannel();
    const payload = buildReminderPayload(entry, at);
    await backend.cancel(payload.id);
    const route = await backend.schedule(payload);
    return { ok: true, at: at.toISOString(), ...(route ? { route } : {}) };
  } catch (err) {
    return { ok: false, reason: "failed", message: `Couldn't set the reminder: ${describe(err)}` };
  }
}

/** Cancels the alarm. ok:false only when a real cancel was attempted and failed. */
export async function clearReminder(
  entryId: string,
  backend: ReminderBackend = getBackend()
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Nothing to cancel where reminders can't exist (desktop/web): the caller
  // can still clear the saved time.
  if (!backend.supported()) return { ok: true };
  try {
    await backend.cancel(reminderNotificationId(entryId));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Couldn't cancel the reminder: ${describe(err)}` };
  }
}

/** Fire-and-forget cancel for trash/delete paths — never throws, never blocks. */
export function cancelReminderSilently(entryId: string, backend: ReminderBackend = getBackend()): void {
  void clearReminder(entryId, backend).catch(() => {});
}

/**
 * Re-registers an entry's reminder with its CURRENT title / lock state.
 * Used after locking or unlocking (so the lock screen never keeps showing a
 * now-private title) and after restoring from Trash. It never prompts for
 * permission — if notifications aren't already allowed it simply does
 * nothing — and never throws.
 */
export async function syncReminderSilently(
  entry: ReminderSubject,
  backend: ReminderBackend = getBackend(),
  now: Date = new Date()
): Promise<void> {
  try {
    if (!backend.supported() || !isActiveReminder(entry.reminderAt, now)) return;
    if ((await backend.permissionState()) !== "granted") return;
    await backend.createChannel();
    const payload = buildReminderPayload(entry, new Date(entry.reminderAt as string));
    await backend.cancel(payload.id);
    await backend.schedule(payload);
  } catch {
    /* best effort: the reminder set earlier is still scheduled as it was */
  }
}

/**
 * Opens the right note when a reminder is tapped. Returns an unsubscribe
 * function. A tap on a COLD start may fire before this listener exists
 * (the plugin raises it while loading); that case lands on the home screen
 * instead — unverified on device either way, so it fails soft.
 */
export async function installReminderTapHandler(
  navigate: (path: string) => void,
  backend: ReminderBackend = getBackend()
): Promise<() => void> {
  if (!backend.supported()) return () => {};
  try {
    return await backend.onTap((extra) => {
      const path = reminderTapPath(extra);
      if (path) navigate(path);
    });
  } catch {
    return () => {};
  }
}

// ---- the real backend ------------------------------------------------------

function toPermissionState(value: unknown): PermissionState {
  if (value === "granted" || value === true) return "granted";
  if (value === "denied" || value === false) return "denied";
  return "prompt";
}

const tauriBackend: ReminderBackend = {
  supported: () => {
    try {
      return isTauri() && /android/i.test(navigator.userAgent);
    } catch {
      return false;
    }
  },
  // is_permission_granted: true = granted, false = denied, null = not asked yet.
  permissionState: async () => toPermissionState(await invoke("plugin:notification|is_permission_granted")),
  // On Android 13+ this shows the POST_NOTIFICATIONS dialog; once denied
  // for good it just returns "denied" without asking again.
  requestPermission: async () => toPermissionState(await invoke("plugin:notification|request_permission")),
  createChannel: async () => {
    // Importance 4 = High (sound + heads-up). Safe to repeat: Android keeps
    // the first settings a channel was created with.
    await invoke("plugin:notification|create_channel", {
      id: REMINDER_CHANNEL_ID,
      name: "Reminders",
      description: "Reminders you set on notes, todos and boards",
      importance: 4,
      vibration: true,
      lights: true,
    });
  },
  schedule: async (payload) => {
    // `batch` saves the notification (boot restore, tap payload); `notify`
    // does not — see the header. `sourceJson` is the notification's own JSON.
    const sourceJson = JSON.stringify(payload);
    try {
      await invoke("plugin:notification|batch", { notifications: [{ ...payload, sourceJson }] });
      return "batch";
    } catch (err) {
      // Alarm only (no boot restore, tap can't open the note) beats no alarm.
      await invoke("plugin:notification|notify", { options: payload });
      return `notify (batch failed: ${describe(err)})`;
    }
  },
  cancel: async (id) => {
    await invoke("plugin:notification|cancel", { notifications: [id] });
  },
  onTap: async (handler) => {
    const listener = await addPluginListener<{ notification?: { extra?: unknown } }>("notification", "actionPerformed", (payload) =>
      handler(payload?.notification?.extra)
    );
    return () => void listener.unregister().catch(() => {});
  },
};

/**
 * The real backend, unless a test has installed its own. The override is a
 * plain global (`__midnoteReminderBackend`) so the jsdom smoke test — which
 * has no Android and no Tauri — can drive the whole Reminder sheet against a
 * recording fake. Nothing in the app ever sets it.
 */
export function getBackend(): ReminderBackend {
  const override = (globalThis as { __midnoteReminderBackend?: ReminderBackend }).__midnoteReminderBackend;
  return override ?? tauriBackend;
}
