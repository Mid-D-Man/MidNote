// Round 37 — reactive wrapper over utils/readAloudController.ts plus the
// user's voice settings. Components talk to this file only.
import { breadcrumb } from "$lib/debug/log.svelte";
import { pushToast } from "$lib/stores/toast.svelte";
import type { Entry } from "$lib/types/entry";
import { ReadAloudController, type ReadState } from "$lib/utils/readAloudController";
import { DEFAULT_SPEECH, entryToSpeechText, sanitizeSpeechSettings, speechClean, type SpeechSettings } from "$lib/utils/speech";
import { realTtsBackend, type TtsVoice } from "$lib/utils/ttsBackend";

const SETTINGS_KEY = "midnote:tts";

function loadSettings(): SpeechSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SPEECH };
  try {
    return sanitizeSpeechSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_SPEECH };
  }
}

export const ttsSettings = $state<SpeechSettings>(loadSettings());
export const readAloud = $state<ReadState>({ status: "idle", id: null, chunkCount: 0, index: 0 });

// Round 38: how far (px) the "Reading aloud" bar sits above the screen's bottom
// slot. The note editor publishes the height of its bottom panel here (the
// formatting toolbar with any open popup, or the find bar) so the bar rides
// ABOVE that panel instead of on top of it. 0 on pages with no such panel.
export const readBarLift = $state<{ px: number }>({ px: 0 });

/** Change voice / speed / pitch. Everything is re-validated, then saved. */
export function updateTtsSettings(patch: Partial<SpeechSettings>) {
  const next = sanitizeSpeechSettings({ ...ttsSettings, ...patch });
  ttsSettings.voiceId = next.voiceId;
  ttsSettings.rate = next.rate;
  ttsSettings.pitch = next.pitch;
  if (typeof localStorage !== "undefined") localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

let controller: ReadAloudController | null = null;
function ctl(): ReadAloudController {
  if (!controller) {
    controller = new ReadAloudController({
      backend: realTtsBackend(),
      settings: () => ({ voiceId: ttsSettings.voiceId, rate: ttsSettings.rate, pitch: ttsSettings.pitch }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onChange: (s) => Object.assign(readAloud, s),
      onNothingSpoken: () =>
        pushToast({
          title: "Nothing was spoken",
          description: "The voice may not be installed. Check Settings → Read aloud, or your phone's Text-to-speech settings.",
          variant: "destructive",
        }),
      onFailure: (message) => pushToast({ title: "Reading stopped", description: message, variant: "destructive" }),
      log: breadcrumb,
    });
  }
  return controller;
}

export function readAloudSupported(): boolean {
  return realTtsBackend().supported();
}

/** True while something is being read or is paused — NOT once it has finished (then only Replay is on offer). */
export function isReadingStatus(status: ReadState["status"]): boolean {
  return status === "starting" || status === "reading" || status === "paused";
}

/** Pause (Android's engine can't, so this stops and remembers which sentence it was on), resume it, or read it all again. */
export async function pauseReading(): Promise<void> {
  breadcrumb("read aloud: pause tapped");
  await ctl().pause();
}

export async function resumeReading(): Promise<void> {
  breadcrumb("read aloud: resume tapped");
  const r = await ctl().resume();
  if (r && !r.ok && !r.cancelled) pushToast({ title: "Couldn't resume", description: r.message, variant: "destructive" });
}

/** The bar's slider: jump to piece `index` (reads on from there; while paused only moves the position). */
export async function seekReading(index: number): Promise<void> {
  breadcrumb(`read aloud: slider -> piece ${index + 1}`);
  const r = await ctl().seek(index);
  if (r && !r.ok && !r.cancelled) pushToast({ title: "Couldn't jump there", description: r.message, variant: "destructive" });
}

export async function replayReading(): Promise<void> {
  breadcrumb("read aloud: replay tapped");
  const r = await ctl().replay();
  if (r && !r.ok && !r.cancelled) pushToast({ title: "Couldn't replay", description: r.message, variant: "destructive" });
}

/** Close the bar (also what Stop does). */
export async function closeReading(): Promise<void> {
  await ctl().stop();
}

/** Start reading `entry`, or stop if it is the one being read. Shows its own toasts. */
export async function toggleReadAloud(entry: Entry): Promise<void> {
  if (isReadingStatus(readAloud.status) && readAloud.id === entry.id) {
    breadcrumb(`read aloud: stop tapped (${entry.type} ${entry.id})`);
    await ctl().stop();
    return;
  }
  if (entry.encrypted) {
    pushToast({ title: "Unlock first", description: "Unlock this entry before having it read aloud.", variant: "destructive" });
    return;
  }
  if (!readAloudSupported()) {
    pushToast({ title: "Read aloud works in the Android app", description: "It uses your phone's text-to-speech voices.", variant: "destructive" });
    return;
  }
  const text = entryToSpeechText(entry);
  breadcrumb(`read aloud: start (${entry.type} ${entry.id}, ${text.length} chars)`);
  const result = await ctl().start(entry.id, text);
  if (!result.ok && !result.cancelled) pushToast({ title: "Couldn't read aloud", description: result.message, variant: "destructive" });
}

/**
 * Read only the text the user selected in an editor. It takes over from
 * whatever is being read (the engine's first piece flushes the queue). The
 * session is filed under the entry's id, so the Actions row and the Stop bar
 * behave exactly as they do for a whole-entry read.
 */
export async function readSelectionAloud(entryId: string, rawSelection: string): Promise<void> {
  if (!readAloudSupported()) {
    pushToast({ title: "Read aloud works in the Android app", description: "It uses your phone's text-to-speech voices.", variant: "destructive" });
    return;
  }
  const text = speechClean(rawSelection);
  if (!text) {
    pushToast({ title: "Nothing to read", description: "Select some text first.", variant: "destructive" });
    return;
  }
  breadcrumb(`read aloud: selection (${entryId}, ${text.length} chars)`);
  const result = await ctl().start(entryId, text);
  if (!result.ok && !result.cancelled) pushToast({ title: "Couldn't read aloud", description: result.message, variant: "destructive" });
}

/** Called when an editor goes away: reading must not outlive the page that started it. */
export function stopReadingFor(id: string): void {
  if (readAloud.status !== "idle" && readAloud.id === id) void ctl().stop();
}

export async function loadTtsVoices(): Promise<{ voices: TtsVoice[]; ready: boolean }> {
  return realTtsBackend().getVoices();
}

export async function previewTtsVoice(): Promise<void> {
  if (!readAloudSupported()) {
    pushToast({ title: "Read aloud works in the Android app", variant: "destructive" });
    return;
  }
  const r = await ctl().preview("This is how your notes will sound when they are read aloud.");
  if (!r.ok) pushToast({ title: "Couldn't play the sample", description: r.message, variant: "destructive" });
}
