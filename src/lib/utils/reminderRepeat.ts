// Round 44 — recurring reminders: the calendar maths, with no Tauri / Svelte in
// it so it can be tested in Node (including across time zones and DST).
//
// THE MODEL. A repeating reminder is { rule, anchor }. `anchor` is the first
// occurrence the user picked, as LOCAL wall-clock text ("2026-10-09T09:00"),
// not a UTC instant: "every day at 9:00" must mean 9:00 on the phone's clock
// wherever the phone is, like an alarm clock. Occurrence k is computed from the
// anchor every time (never from the previous occurrence), so a month that is too
// short can't drag later months along: "monthly on the 31st" gives Feb 28, then
// Mar 31, Apr 30 ...
//
// WHY THE APP SCHEDULES SEVERAL OCCURRENCES AHEAD (see utils/reminders.ts): the
// notification plugin's own repeat options are not usable for this — `repeating`
// repeats at "time until the first alarm", `every` is inexact and starts from now,
// and its calendar ("interval") mode re-arms with a non-idle exact alarm, which
// Android may hold back while the phone dozes. One normal exact alarm per
// occurrence is what a plain reminder already uses and is known to work.

import type { ReminderRepeat, ReminderRepeatRule } from "$lib/types/entry";

export const REPEAT_RULES: ReadonlyArray<{ rule: ReminderRepeatRule; label: string }> = [
  { rule: "daily", label: "Daily" },
  { rule: "weekdays", label: "Weekdays" },
  { rule: "weekly", label: "Weekly" },
  { rule: "monthly", label: "Monthly" },
  { rule: "yearly", label: "Yearly" },
];

const RULE_SET = new Set<string>(REPEAT_RULES.map((r) => r.rule));

export function isRepeatRule(v: unknown): v is ReminderRepeatRule {
  return typeof v === "string" && RULE_SET.has(v);
}

/**
 * How many occurrences are kept scheduled ahead of time, per rule. Enough that a
 * reminder keeps going for weeks/months without the app being opened; the app tops
 * the list up every time it starts or comes to the foreground.
 */
export function horizonFor(rule: ReminderRepeatRule): number {
  switch (rule) {
    case "daily":
    case "weekdays":
      return 21;
    case "weekly":
      return 8;
    case "monthly":
      return 6;
    case "yearly":
      return 3;
  }
}

/** Largest horizon — the number of notification ids a reminder can occupy. */
export const MAX_HORIZON = 21;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-09T09:00" from a Date's LOCAL fields. */
export function toAnchor(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Parts {
  y: number;
  m: number; // 0-11
  d: number;
  h: number;
  mi: number;
}

function parseAnchor(anchor: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(anchor);
  if (!m) return null;
  const p = { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]) };
  // reject 31 Feb / 25:00 style values that Date would silently roll over
  const back = new Date(p.y, p.m, p.d, p.h, p.mi, 0, 0);
  if (back.getFullYear() !== p.y || back.getMonth() !== p.m || back.getDate() !== p.d || back.getHours() !== p.h || back.getMinutes() !== p.mi) return null;
  return p;
}

/** Anything that isn't a well-formed { rule, anchor } becomes null. */
export function sanitizeRepeat(raw: unknown): ReminderRepeat | null {
  if (!raw || typeof raw !== "object") return null;
  const { rule, anchor } = raw as { rule?: unknown; anchor?: unknown };
  if (!isRepeatRule(rule) || typeof anchor !== "string" || !parseAnchor(anchor)) return null;
  return { rule, anchor };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** The k-th step of the rule from the anchor, ignoring the weekday filter (k = 0 is the anchor itself). */
function stepAt(rule: ReminderRepeatRule, p: Parts, k: number): Date {
  switch (rule) {
    case "daily":
    case "weekdays":
      return new Date(p.y, p.m, p.d + k, p.h, p.mi, 0, 0);
    case "weekly":
      return new Date(p.y, p.m, p.d + 7 * k, p.h, p.mi, 0, 0);
    case "monthly": {
      const total = p.m + k;
      const y = p.y + Math.floor(total / 12);
      const m = ((total % 12) + 12) % 12;
      return new Date(y, m, Math.min(p.d, daysInMonth(y, m)), p.h, p.mi, 0, 0);
    }
    case "yearly": {
      const y = p.y + k;
      return new Date(y, p.m, Math.min(p.d, daysInMonth(y, p.m)), p.h, p.mi, 0, 0);
    }
  }
}

const DAY_MS = 86_400_000;
const MAX_STEPS = 20_000;

/** A step index safely at or before the first occurrence after `after`, so far-past anchors don't loop for years. */
function startIndex(rule: ReminderRepeatRule, p: Parts, after: Date): number {
  const anchor = new Date(p.y, p.m, p.d, p.h, p.mi, 0, 0);
  const diffMs = after.getTime() - anchor.getTime();
  if (diffMs <= 0) return 0;
  let k: number;
  switch (rule) {
    case "daily":
    case "weekdays":
      k = Math.floor(diffMs / DAY_MS) - 2;
      break;
    case "weekly":
      k = Math.floor(diffMs / (7 * DAY_MS)) - 2;
      break;
    case "monthly":
      k = (after.getFullYear() - p.y) * 12 + (after.getMonth() - p.m) - 2;
      break;
    case "yearly":
      k = after.getFullYear() - p.y - 2;
      break;
  }
  return Math.max(0, k);
}

/**
 * The next `count` occurrences strictly after `after`, oldest first. Weekends are
 * skipped for "weekdays" (an anchor on a Saturday simply starts on Monday).
 */
export function occurrencesAfter(repeat: ReminderRepeat, after: Date, count: number): Date[] {
  const p = parseAnchor(repeat.anchor);
  if (!p || !isRepeatRule(repeat.rule) || count <= 0) return [];
  const out: Date[] = [];
  let k = startIndex(repeat.rule, p, after);
  for (let steps = 0; out.length < count && steps < MAX_STEPS; steps++, k++) {
    const d = stepAt(repeat.rule, p, k);
    if (repeat.rule === "weekdays" && (d.getDay() === 0 || d.getDay() === 6)) continue;
    if (d.getTime() > after.getTime()) out.push(d);
  }
  return out;
}

/** The first occurrence at or after `from` (used when a reminder is first set). */
export function firstOccurrenceFrom(repeat: ReminderRepeat, from: Date): Date | null {
  return occurrencesAfter(repeat, new Date(from.getTime() - 1), 1)[0] ?? null;
}

/** The next time a repeating reminder will go off, after `now`. */
export function nextOccurrence(repeat: ReminderRepeat, now: Date = new Date()): Date | null {
  return occurrencesAfter(repeat, now, 1)[0] ?? null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Every day", "Every weekday", "Every Monday", "Monthly on the 15th", "Every year on 3 Oct". */
export function describeRepeat(repeat: ReminderRepeat): string {
  const p = parseAnchor(repeat.anchor);
  if (!p) return "";
  switch (repeat.rule) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      return `Every ${WEEKDAY_NAMES[new Date(p.y, p.m, p.d).getDay()]}`;
    case "monthly":
      return `Monthly on the ${ordinal(p.d)}`;
    case "yearly":
      return `Every year on ${p.d} ${MONTH_NAMES[p.m]}`;
  }
}

/**
 * When the entry's reminder will next go off — the one answer the UI should use.
 * One-off: its time, if still ahead. Repeating: computed from the rule, so it is
 * right even if the stored `reminderAt` is stale because the app hasn't been opened
 * since the last occurrence.
 */
export function reminderDueAt(entry: { reminderAt?: string | null; reminderRepeat?: ReminderRepeat | null }, now: Date = new Date()): string | null {
  if (entry.reminderRepeat) {
    const next = nextOccurrence(entry.reminderRepeat, now);
    return next ? next.toISOString() : null;
  }
  if (!entry.reminderAt) return null;
  const t = Date.parse(entry.reminderAt);
  return Number.isFinite(t) && t > now.getTime() ? entry.reminderAt : null;
}
