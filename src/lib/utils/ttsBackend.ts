// Round 37 — the seam between the app and the phone's speech engine.
//
// WHY A PLUGIN: the Android WebView has no Web Speech API (speechSynthesis is
// missing or a silent stub — same gap as navigator.share), so speaking needs
// native code. tauri-plugin-tts 0.2.1 (source read: Kotlin TtsPlugin + Rust
// commands/models) drives Android's own TextToSpeech engine. It is called with
// plain invoke(), like the reminders and share plugins.
//
// Argument shapes taken from that source: speak / get_voices take their
// arguments under a key named `payload`; stop / is_speaking / is_initialized
// take none. speak resolves { success, warning?, utteranceId }.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type TtsVoice = { id: string; name: string; language: string };
export type SpeakOptions = { voiceId: string | null; rate: number; pitch: number; queue: "flush" | "add" };

/**
 * What the engine tells us about a piece it was given. The plugin re-emits the
 * Android engine's utterance callbacks as app events; `id` is the utterance id
 * that `speak` returned. There is no position INSIDE a piece — only start/finish.
 */
export type TtsEventType = "start" | "finish" | "cancel" | "error" | "interrupted";
export type TtsEvent = { type: TtsEventType; id: string | null };
export type SpeakResult = { warning?: string; utteranceId?: string };

export interface TtsBackend {
  /** false in a browser tab / on desktop, where the plugin isn't compiled in. */
  supported(): boolean;
  /** `ready: false` = the engine is still starting; try again in a moment. */
  getVoices(): Promise<{ voices: TtsVoice[]; ready: boolean }>;
  /** Resolves with the plugin's warning (it substituted a voice) and the utterance id. Rejects with the plugin's message otherwise. */
  speak(text: string, options: SpeakOptions): Promise<SpeakResult>;
  /**
   * Subscribe to the engine's start/finish events. Resolves with an unsubscribe
   * function; rejects when events can't be set up (the caller then works without
   * knowing which piece is being spoken — see readAloudController.ts).
   */
  onEvent(handler: (e: TtsEvent) => void): Promise<() => void>;
  stop(): Promise<void>;
  isSpeaking(): Promise<boolean>;
}

declare global {
  // Test seam only (jsdom has no Android): replaces the real backend.
  // eslint-disable-next-line no-var
  var __midnoteTtsBackend: TtsBackend | undefined;
}

const isVoice = (v: unknown): v is TtsVoice =>
  !!v && typeof v === "object" && typeof (v as TtsVoice).id === "string" && (v as TtsVoice).id.length > 0 && typeof (v as TtsVoice).name === "string" && typeof (v as TtsVoice).language === "string";

export function realTtsBackend(): TtsBackend {
  if (globalThis.__midnoteTtsBackend) return globalThis.__midnoteTtsBackend;
  return {
    supported: () => isTauri() && typeof navigator !== "undefined" && /android/i.test(navigator.userAgent),
    async getVoices() {
      const r = await invoke<{ voices?: unknown[] }>("plugin:tts|get_voices", { payload: {} });
      const voices = Array.isArray(r?.voices) ? r.voices.filter(isVoice) : [];
      if (voices.length > 0) return { voices, ready: true };
      // An empty list means either "still starting" or "no voices installed"; the engine says which.
      const init = await invoke<{ initialized?: boolean }>("plugin:tts|is_initialized").catch(() => null);
      return { voices, ready: init?.initialized === true };
    },
    async speak(text, o) {
      const r = await invoke<{ success?: boolean; warning?: string; utteranceId?: string }>("plugin:tts|speak", {
        payload: { text, ...(o.voiceId ? { voiceId: o.voiceId } : {}), rate: o.rate, pitch: o.pitch, queueMode: o.queue },
      });
      if (r && r.success === false) throw new Error(r.warning ?? "The speech engine didn't start.");
      return { warning: r?.warning, utteranceId: typeof r?.utteranceId === "string" ? r.utteranceId : undefined };
    },
    async onEvent(handler) {
      // The relay must be registered once before Android can send anything; then the
      // plugin re-emits each callback as a plain app event named tts://speech:<type>.
      await invoke("plugin:tts|register_listener");
      const types: TtsEventType[] = ["start", "finish", "cancel", "error", "interrupted"];
      const offs = await Promise.all(
        types.map((type) =>
          listen<{ id?: string }>(`tts://speech:${type}`, (e) => handler({ type, id: typeof e.payload?.id === "string" ? e.payload.id : null })),
        ),
      );
      return () => offs.forEach((off) => off());
    },
    async stop() {
      await invoke("plugin:tts|stop");
    },
    async isSpeaking() {
      const r = await invoke<{ speaking?: boolean }>("plugin:tts|is_speaking");
      return r?.speaking === true;
    },
  };
}
