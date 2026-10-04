// Round 37 — reactive wrapper over utils/readAloudController.ts plus the
// user's voice settings. Components talk to this file only.
import { breadcrumb } from "$lib/debug/log.svelte";
import { pushToast } from "$lib/stores/toast.svelte";
import type { Entry } from "$lib/types/entry";
import { ReadAloudController, type ReadState } from "$lib/utils/readAloudController";
import { DEFAULT_SPEECH, entryToSpeechText, sanitizeSpeechSettings, type SpeechSettings } from "$lib/utils/speech";
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
export const readAloud = $state<ReadState>({ status: "idle", id: null, chunkCount: 0 });

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
      log: breadcrumb,
    });
  }
  return controller;
}

export function readAloudSupported(): boolean {
  return realTtsBackend().supported();
}

/** Start reading `entry`, or stop if it is the one being read. Shows its own toasts. */
export async function toggleReadAloud(entry: Entry): Promise<void> {
  if (readAloud.status !== "idle" && readAloud.id === entry.id) {
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
