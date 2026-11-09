// Round U — settings sync, part 2: the rules. Plain TypeScript, no stores, no network: tested in Node.
//
// WHAT SYNCS: the look-and-feel settings in SYNCED_SETTING_KEYS (settingsStamps.ts): the app and card themes, ruled lines,
// list / grid view, text size, the default note font, and speech speed and pitch.
// WHAT DOES NOT: custom themes, icons and fonts themselves (they are files on one phone: a setting that points at one this
// phone lacks falls back to the plain look, as it already does); the speech VOICE (voices differ from phone to phone, so
// each phone keeps its own); everything per-device (debug panel, last open tab, sync state, the session).
//
// HOW: each phone stamps a setting when the person changes it (settingsStamps.ts). A sync sends this phone's stamped
// settings as { key: { v: "text", t: stamp } } and the server (midnote_merge_settings) keeps, for each key, the one with
// the newer `t`, and answers with the merged set. This phone then applies every key whose `t` is newer than its own.
// So two phones changing DIFFERENT settings both keep their change, and for the SAME setting the later change wins.
//
// The tag list rides in the same call as one more entry, `midnote:known-tags`, merged tag by tag instead of whole-value
// (utils/tagSync.ts): that is how tags that no note, todo or board uses reach the other phones.
//
// Everything that comes back is untrusted: each value is checked against what that setting can hold before it is used.
import { sanitizeFamilyValue } from "$lib/utils/fonts";
import { sanitizeSpeechSettings } from "$lib/utils/speech";
import { SYNCED_SETTING_KEYS, type Stamps } from "$lib/utils/settingsStamps";
import { TAGS_WIRE_KEY, finishTags, prepareTags, serverKept, type TagSyncDeps } from "$lib/utils/tagSync";

export type SettingWire = { v: string | null; t: number };
export type SettingsWire = Record<string, SettingWire>;

/** Text sizes the size picker offers (stores/settings.svelte.ts FONT_SIZES: a test keeps the two equal). */
export const SYNCED_FONT_SIZES: readonly number[] = [10, 12, 14, 15, 16, 18, 20, 24];
export const MAX_VALUE_CHARS = 2000;
/** A stamp this far ahead of this phone's clock is treated as "now": one phone with a wrong clock must not win forever. */
export const FUTURE_SLACK_MS = 5 * 60 * 1000;

export interface SettingsIo {
  get(key: string): string | null;
  /** null removes the stored value. */
  set(key: string, value: string | null): void;
}

export class SettingsSyncError extends Error {
  kind: "unavailable" | "auth" | "network" | "server" | "rejected" | "quota" | "rate-limited";
  constructor(kind: SettingsSyncError["kind"], message: string) {
    super(message);
    this.name = "SettingsSyncError";
    this.kind = kind;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isThemeRef(text: string): boolean {
  const o = parseJson(text);
  return !!o && typeof o === "object" && typeof (o as { kind?: unknown }).kind === "string";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The text to send for `key`, from its stored text. null = nothing stored (only the note font can be "unset"). */
export function toWire(key: string, raw: string | null): string | null {
  if (raw === null) return null;
  if (key === "midnote:tts") {
    // the voice stays on this phone: only speed and pitch travel
    const s = sanitizeSpeechSettings(parseJson(raw));
    return JSON.stringify({ rate: s.rate, pitch: s.pitch });
  }
  return raw;
}

export type FromWire = { ok: true; raw: string | null } | { ok: false };

/** The text to store for `key` from what arrived (checked), or { ok: false } to ignore it. `localRaw` is what is stored now. */
export function fromWire(key: string, v: string | null, localRaw: string | null): FromWire {
  if (key === "midnote:note-font") {
    if (v === null) return { ok: true, raw: null };
    const clean = typeof v === "string" ? sanitizeFamilyValue(v) : null;
    return clean === null ? { ok: false } : { ok: true, raw: clean };
  }
  if (typeof v !== "string" || v.length > MAX_VALUE_CHARS) return { ok: false };
  switch (key) {
    case "midnote:app-header-theme":
    case "midnote:app-body-theme":
      return isThemeRef(v) ? { ok: true, raw: v } : { ok: false };
    case "midnote:note-lines":
      return v === "true" || v === "false" ? { ok: true, raw: v } : { ok: false };
    case "midnote:list-view":
      return v === "list" || v === "grid" ? { ok: true, raw: v } : { ok: false };
    case "midnote:font-size": {
      const n = /^\d{1,3}$/.test(v) ? parseInt(v, 10) : NaN;
      return SYNCED_FONT_SIZES.includes(n) ? { ok: true, raw: String(n) } : { ok: false };
    }
    case "midnote:tts": {
      const o = parseJson(v);
      if (!o || typeof o !== "object") return { ok: false };
      const rate = num((o as Record<string, unknown>).rate);
      const pitch = num((o as Record<string, unknown>).pitch);
      if (rate === null || pitch === null) return { ok: false };
      const local = sanitizeSpeechSettings(localRaw === null ? null : parseJson(localRaw));
      return { ok: true, raw: JSON.stringify(sanitizeSpeechSettings({ ...local, rate, pitch })) };
    }
    default:
      return { ok: false };
  }
}

/** Settings that were set before this feature existed get stamp 1: any real change made afterwards, anywhere, wins over them. */
export function bootstrapStamps(io: SettingsIo, stamps: Stamps): Stamps {
  const out: Stamps = { ...stamps };
  for (const key of SYNCED_SETTING_KEYS) {
    if (out[key] === undefined && io.get(key) !== null) out[key] = 1;
  }
  return out;
}

/** What this phone sends: every setting it has a stamp for, with its current value. */
export function outgoing(io: SettingsIo, stamps: Stamps): SettingsWire {
  const out: SettingsWire = {};
  for (const key of SYNCED_SETTING_KEYS) {
    const t = stamps[key];
    if (t === undefined || t <= 0) continue;
    const raw = io.get(key);
    if (raw === null && key !== "midnote:note-font") continue; // only the note font can be "set back to the default"
    const v = toWire(key, raw);
    if (v !== null && v.length > MAX_VALUE_CHARS) continue;
    out[key] = { v, t };
  }
  return out;
}

export interface IncomingResult {
  stamps: Stamps;
  /** Keys whose stored value actually changed. */
  applied: string[];
}

/** Apply what the server answered: each key that is newer than this phone's own and valid. */
export function applyIncoming(remote: unknown, io: SettingsIo, stamps: Stamps, now: number): IncomingResult {
  const next: Stamps = { ...stamps };
  const applied: string[] = [];
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return { stamps: next, applied };
  for (const key of SYNCED_SETTING_KEYS) {
    const entry = (remote as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const t0 = num(e.t);
    if (t0 === null || t0 <= 0) continue;
    const t = Math.min(t0, now + FUTURE_SLACK_MS);
    // Older than this phone's own change: keep ours (the server has it too, from this very call). The SAME stamp with a
    // different value is a tie (two phones that had the setting from before this feature, or two changes in one millisecond):
    // the server's answer decides, so every phone ends with the same value.
    if (t < (next[key] ?? 0)) continue;
    const v = e.v === null || typeof e.v === "string" ? (e.v as string | null) : undefined;
    if (v === undefined) continue;
    const local = io.get(key);
    const result = fromWire(key, v, local);
    if (!result.ok) continue;
    if (result.raw !== local) {
      io.set(key, result.raw);
      applied.push(key);
    }
    next[key] = t;
  }
  return { stamps: next, applied };
}

export interface SettingsSyncDeps {
  io: SettingsIo;
  loadStamps(): Stamps;
  saveStamps(stamps: Stamps): void;
  /** Send `out`, get the merged settings back. Throws SettingsSyncError. */
  exchange(out: SettingsWire): Promise<unknown>;
  now(): number;
  /** Called with the keys whose value changed, after they were stored (the app re-reads its stores here). */
  onApplied(keys: string[]): void;
  /** The tag list (utils/tagSync.ts). Left out = the tag list does not sync. */
  tags?: TagSyncDeps;
}

/** How the tag part of a settings sync went. */
export interface TagOutcome {
  added: number;
  removed: number;
  /** Marks left out because there were too many tags to send. */
  dropped: number;
  /** "ok": the server holds this phone's list (or has not got anything newer to say). "not-stored": the server did not keep it
   *  (typically: the SQL update for tags has not been run, so a long list is refused). "not-sent": nothing was sent (restore from cloud). */
  stored: "ok" | "not-stored" | "not-sent";
}

export type SettingsOutcome =
  | { status: "ok"; sent: number; applied: string[]; tags?: TagOutcome; tagError?: string }
  | { status: "unavailable" }
  | { status: "failed"; kind: SettingsSyncError["kind"] | "unexpected"; message: string };

/** One settings sync. `pullOnly` (Restore from cloud) sends nothing and only takes what is newer there. */
export async function runSettingsSync(deps: SettingsSyncDeps, opts: { pullOnly?: boolean } = {}): Promise<SettingsOutcome> {
  let stamps = deps.loadStamps();
  let out: SettingsWire = {};
  const now0 = deps.now();
  const tagPrep = deps.tags ? prepareTags(deps.tags, now0) : null;
  if (!opts.pullOnly) {
    const boot = bootstrapStamps(deps.io, stamps);
    if (Object.keys(boot).length !== Object.keys(stamps).length) deps.saveStamps(boot);
    stamps = boot;
    out = outgoing(deps.io, stamps);
    if (tagPrep?.wire) out[TAGS_WIRE_KEY] = tagPrep.wire;
  }
  let remote: unknown;
  try {
    remote = await deps.exchange(out);
  } catch (e) {
    if (e instanceof SettingsSyncError) {
      if (e.kind === "unavailable") return { status: "unavailable" };
      return { status: "failed", kind: e.kind, message: e.message };
    }
    return { status: "failed", kind: "unexpected", message: e instanceof Error ? e.message.slice(0, 80) : "error" };
  }
  const result = applyIncoming(remote, deps.io, stamps, deps.now());
  deps.saveStamps(result.stamps);
  if (result.applied.length > 0) deps.onApplied(result.applied);
  let tags: TagOutcome | undefined;
  let tagError: string | undefined;
  if (deps.tags && tagPrep) {
    try {
      const fin = finishTags(deps.tags, tagPrep.local, remote, deps.now(), !!opts.pullOnly);
      let stored: TagOutcome["stored"] = opts.pullOnly ? "not-sent" : "ok";
      if (fin.resend) {
        try {
          const answer2 = await deps.exchange({ [TAGS_WIRE_KEY]: fin.resend });
          stored = serverKept(answer2, fin.resend) ? "ok" : "not-stored";
        } catch {
          stored = "not-stored";
        }
      }
      tags = { added: fin.added, removed: fin.removed, dropped: fin.dropped, stored };
    } catch (e) {
      // the tag part must never turn a finished settings sync into a failed one: say so (a note and the debug log) and go on
      tags = undefined;
      tagError = e instanceof Error ? e.message.slice(0, 80) : "error";
    }
  }
  const sentCount = Object.keys(out).length - (out[TAGS_WIRE_KEY] ? 1 : 0); // the settings sent: the tag list is counted in `tags`
  return { status: "ok", sent: sentCount, applied: result.applied, ...(tags ? { tags } : {}), ...(tagError ? { tagError } : {}) };
}

/** "2 added, 1 removed" for a toast. */
export function describeTagChanges(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  return parts.join(", ");
}

/** "Text size, Ruled lines" for a toast. */
export function describeApplied(keys: readonly string[]): string {
  const names: Record<string, string> = {
    "midnote:app-header-theme": "top bar theme",
    "midnote:app-body-theme": "page theme",
    "midnote:note-lines": "ruled lines",
    "midnote:list-view": "list / grid view",
    "midnote:font-size": "text size",
    "midnote:note-font": "note font",
    "midnote:tts": "read-aloud speed",
  };
  const list = keys.map((k) => names[k]).filter((n): n is string => !!n);
  return list.length === 0 ? "" : list.join(", ");
}
