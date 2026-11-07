// Round U — settings sync, part 1: WHEN each synced setting was last changed on this phone.
//
// Two phones that both changed a setting need a way to agree which change is newer, so every time the person changes
// one of the look-and-feel settings below the app writes a timestamp for it here (milliseconds since 1970). The sync
// (utils/settingsSync.ts) sends these with the values, and the newer one wins, setting by setting.
//
// This file is tiny and imports nothing from the app, so the stores can call stampSetting() from their setters without
// any risk of an import loop. It works whether settings sync is on or off, so switching it on later still has times to go by.

/** The settings that travel. The legacy `midnote:app-theme` (read once for migration, never written) and everything
 *  per-device (debug panel, last open tab, sync state, session, ...) are NOT here. */
export const SYNCED_SETTING_KEYS: readonly string[] = [
  "midnote:app-header-theme",
  "midnote:app-body-theme",
  "midnote:note-lines",
  "midnote:list-view",
  "midnote:font-size",
  "midnote:note-font",
  "midnote:tts",
];

export const SETTINGS_STATE_KEY = "midnote:settings-sync";

/** key -> when it was last changed on this phone (ms). 1 = "was already set before this feature existed". */
export type Stamps = Record<string, number>;

export type StampStorage = Pick<Storage, "getItem" | "setItem">;

/** The stamps from their stored text. Anything that is not a plain number for a known key is dropped. */
export function parseStamps(raw: string | null): Stamps {
  const out: Stamps = {};
  if (!raw) return out;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!o || typeof o !== "object") return out;
  const s = (o as { stamps?: unknown }).stamps;
  if (!s || typeof s !== "object") return out;
  for (const key of SYNCED_SETTING_KEYS) {
    const v = (s as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}

export function serializeStamps(stamps: Stamps): string {
  return JSON.stringify({ v: 1, stamps });
}

function realStorage(): StampStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadStamps(storage: StampStorage | null = realStorage()): Stamps {
  if (!storage) return {};
  try {
    return parseStamps(storage.getItem(SETTINGS_STATE_KEY));
  } catch {
    return {};
  }
}

export function saveStamps(stamps: Stamps, storage: StampStorage | null = realStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_STATE_KEY, serializeStamps(stamps));
  } catch {
    /* storage full or blocked: the setting still works, it just won't win a conflict */
  }
}

/** Record that `key` was just changed here. Keys that do not travel are ignored. */
export function stampSetting(key: string, now: number = Date.now(), storage: StampStorage | null = realStorage()): void {
  if (!SYNCED_SETTING_KEYS.includes(key)) return;
  const stamps = loadStamps(storage);
  // always newer than what was there, even if the clock went backwards
  stamps[key] = Math.max(now, (stamps[key] ?? 0) + 1);
  saveStamps(stamps, storage);
}
