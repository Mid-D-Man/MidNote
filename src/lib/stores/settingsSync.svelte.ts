// Round U — settings sync, as the rest of the app sees it. The rules are in utils/settingsSync.ts and the stamps in
// utils/settingsStamps.ts; this file wires them to this phone's storage and live stores.
//
// A settings sync is one more step of a notes sync (stores/sync.svelte.ts calls syncSettings() right after the notes
// step), so it follows the same switch: with "Sync automatically" off it runs when the person taps Sync now. It has its
// own switch, "Sync my settings" in Settings -> Account, ON by default. Writes state only from handlers and callbacks,
// never from an $effect.
import { breadcrumb } from "$lib/debug/log.svelte";
import { reloadTtsSettings } from "$lib/stores/readAloud.svelte";
import { reloadSyncedSettings } from "$lib/stores/settings.svelte";
import { sync as reloadTagLists } from "$lib/stores/tags.svelte";
import * as storage from "$lib/storage";
import { loadStamps, saveStamps } from "$lib/utils/settingsStamps";
import { describeApplied, describeTagChanges, runSettingsSync, type SettingsIo, type SettingsOutcome, type SettingsWire } from "$lib/utils/settingsSync";
import { loadTagMarks, saveTagMarks } from "$lib/utils/tagStamps";
import type { TagSyncDeps } from "$lib/utils/tagSync";

const ON_KEY = "midnote:sync-settings";

function loadOn(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(ON_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The person's choice. Default ON. */
export const settingsSyncPrefs = $state({ on: loadOn() });

export function setSettingsSync(on: boolean): void {
  settingsSyncPrefs.on = on;
  try {
    if (on) localStorage.removeItem(ON_KEY);
    else localStorage.setItem(ON_KEY, "off");
  } catch {
    /* storage blocked: the choice holds until the app closes */
  }
}

const realIo: SettingsIo = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage full or blocked */
    }
  },
};

// The tag list (utils/tagSync.ts): read and changed through the same storage the Tags screens use. Changes made here are NOT
// marked as made on this phone (stamp: false): the sync saves the marks it merged, which carry the other phone's times.
const tagDeps: TagSyncDeps = {
  loadRegistry: () => storage.loadKnownTags(),
  loadMarks: () => loadTagMarks(),
  saveMarks: (marks) => saveTagMarks(marks),
  addTag: (scope, tag) => storage.addKnownTag(scope, tag, { stamp: false }),
  removeTag: (scope, tag) => storage.removeKnownTag(scope, tag, { stamp: false }),
  onApplied: () => reloadTagLists(),
};

export type SettingsStep = SettingsOutcome | { status: "off" };

export interface SettingsRemote {
  exchangeSettings(out: SettingsWire): Promise<unknown>;
}

/** What to say about a settings step in a message (empty when there is nothing worth saying). */
export function settingsNote(step: SettingsStep): string {
  if (step.status === "ok") {
    const parts: string[] = [];
    if (step.applied.length > 0) parts.push(`Settings updated from the cloud: ${describeApplied(step.applied)}.`);
    const t = step.tags;
    if (t && (t.added > 0 || t.removed > 0)) parts.push(`Tags updated from the cloud: ${describeTagChanges(t.added, t.removed)}.`);
    if (t && t.stored === "not-stored") parts.push("Your tag list couldn't be saved to the server (run the updated settings SQL).");
    if (step.tagError) parts.push("Your tag list couldn't sync this time.");
    return parts.join(" ");
  }
  if (step.status === "unavailable") return "Settings sync isn't set up on the server yet.";
  if (step.status === "failed") return "Your settings couldn't sync this time.";
  return "";
}

/** Run the settings step. Never throws; a problem here must not make a notes sync look failed. */
export async function syncSettings(remote: SettingsRemote, opts: { pullOnly?: boolean } = {}): Promise<SettingsStep> {
  if (!settingsSyncPrefs.on) return { status: "off" };
  let step: SettingsOutcome;
  try {
    step = await runSettingsSync(
      {
        io: realIo,
        loadStamps: () => loadStamps(),
        saveStamps: (s) => saveStamps(s),
        exchange: (out) => remote.exchangeSettings(out),
        now: () => Date.now(),
        onApplied: (keys) => {
          reloadSyncedSettings();
          if (keys.includes("midnote:tts")) reloadTtsSettings();
        },
        tags: tagDeps,
      },
      opts,
    );
  } catch (e) {
    step = { status: "failed", kind: "unexpected", message: e instanceof Error ? e.message.slice(0, 80) : "error" };
  }
  if (step.status === "ok") {
    const t = step.tags;
    if (step.tagError) breadcrumb(`settings sync: the tag list failed (${step.tagError})`);
    breadcrumb(`settings sync: sent ${step.sent}, took ${step.applied.length}` + (t ? `; tags +${t.added} -${t.removed}, ${t.stored}${t.dropped > 0 ? `, ${t.dropped} left out (too many)` : ""}` : ""));
  }
  else if (step.status === "unavailable") breadcrumb("settings sync: not set up on the server");
  else breadcrumb(`settings sync: failed (${step.kind}) ${step.message}`);
  return step;
}
