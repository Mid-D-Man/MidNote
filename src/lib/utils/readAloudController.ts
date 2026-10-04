// Round 37 — runs one "read this aloud" session against a TtsBackend.
// Plain TypeScript (no runes, no Tauri import) so it can be driven in Node with
// a scripted backend; stores/readAloud.svelte.ts is the reactive wrapper.
//
// HOW A SESSION WORKS (from the plugin's Android source):
//   - Android refuses long texts, so the text is cut into pieces
//     (speech.ts splitForSpeech). The FIRST piece is sent in "flush" mode
//     (cuts off whatever was being said), every later one in "add" mode, which
//     queues it behind the previous ones inside the engine.
//   - There is no JS-visible "finished" call, so completion is POLLED with
//     is_speaking. Two "not speaking" answers in a row end the session
//     (one can happen in the gap between two queued pieces). If speaking was
//     never seen at all, nothing was actually said — usually missing voice data
//     — and that is reported instead of finishing silently.
//   - Stop sends stop() and invalidates the session, so a piece still being
//     queued when you tap Stop is never sent.
import { splitForSpeech, type SpeechSettings } from "$lib/utils/speech";
import type { TtsBackend } from "$lib/utils/ttsBackend";

export type ReadState = { status: "idle" | "starting" | "reading"; id: string | null; chunkCount: number };
export type StartResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; message: string };

export interface ControllerDeps {
  backend: TtsBackend;
  settings: () => SpeechSettings;
  sleep: (ms: number) => Promise<void>;
  onChange: (state: ReadState) => void;
  /** The session ended with nothing ever having been spoken. */
  onNothingSpoken: () => void;
  log?: (msg: string) => void;
}

export const POLL_MS = 700;
const IDLE: ReadState = { status: "idle", id: null, chunkCount: 0 };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ReadAloudController {
  private session = 0;
  private state: ReadState = IDLE;

  constructor(private d: ControllerDeps) {}

  get current(): ReadState {
    return this.state;
  }

  private set(next: ReadState) {
    this.state = next;
    this.d.onChange(next);
  }

  async start(id: string, text: string): Promise<StartResult> {
    const pieces = splitForSpeech(text);
    if (pieces.length === 0) return { ok: false, message: "There's nothing to read in this one." };

    const mine = ++this.session;
    const { voiceId, rate, pitch } = this.d.settings();
    this.set({ status: "starting", id, chunkCount: pieces.length });

    for (let i = 0; i < pieces.length; i++) {
      if (mine !== this.session) return { ok: false, cancelled: true };
      try {
        const warning = await this.d.backend.speak(pieces[i], { voiceId, rate, pitch, queue: i === 0 ? "flush" : "add" });
        if (warning) this.d.log?.(`read aloud: ${warning}`);
      } catch (err) {
        if (mine !== this.session) return { ok: false, cancelled: true };
        const message = describe(err);
        this.d.log?.(`read aloud: piece ${i + 1}/${pieces.length} failed (${message})`);
        this.session++;
        await this.d.backend.stop().catch(() => {});
        this.set(IDLE);
        return { ok: false, message };
      }
      if (i === 0) this.set({ status: "reading", id, chunkCount: pieces.length });
    }
    if (mine === this.session) void this.watch(mine);
    return { ok: true };
  }

  /** Polls until the engine goes quiet (or the session is replaced / stopped). */
  private async watch(mine: number): Promise<void> {
    let sawSpeaking = false;
    let quiet = 0;
    for (;;) {
      await this.d.sleep(POLL_MS);
      if (mine !== this.session) return;
      let speaking = false;
      try {
        speaking = await this.d.backend.isSpeaking();
      } catch {
        speaking = false;
      }
      if (mine !== this.session) return;
      if (speaking) {
        sawSpeaking = true;
        quiet = 0;
      } else if (++quiet >= 2) {
        this.session++;
        this.set(IDLE);
        if (!sawSpeaking) this.d.onNothingSpoken();
        return;
      }
    }
  }

  async stop(): Promise<void> {
    this.session++;
    this.set(IDLE);
    await this.d.backend.stop().catch((err) => this.d.log?.(`read aloud: stop failed (${describe(err)})`));
  }

  /** Say a short sample with the current voice settings (flushes anything being read). */
  async preview(sample: string): Promise<{ ok: true } | { ok: false; message: string }> {
    this.session++;
    this.set(IDLE);
    const { voiceId, rate, pitch } = this.d.settings();
    try {
      await this.d.backend.speak(sample, { voiceId, rate, pitch, queue: "flush" });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }
}
