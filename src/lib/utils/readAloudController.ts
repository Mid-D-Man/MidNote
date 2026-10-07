// Round 37/40 — runs one "read this aloud" session against a TtsBackend.
// Plain TypeScript (no runes, no Tauri import) so it can be driven in Node with
// a scripted backend; stores/readAloud.svelte.ts is the reactive wrapper.
//
// HOW A SESSION WORKS (from the plugin's Android source):
//   - The text is cut into PIECES (speech.ts splitForSpeech). The first piece is
//     sent in "flush" mode (cuts off whatever was being said), every later one in
//     "add" mode, which queues it behind the previous ones inside the engine.
//   - Completion is POLLED with is_speaking: two "not speaking" answers in a row
//     end the session (one can happen in the gap between two queued pieces). If
//     speaking was never seen, nothing was said — usually missing voice data — and
//     that is reported instead of finishing silently.
//
// PAUSE / RESUME / REPLAY (round 40). Android's speech engine cannot pause — the
// plugin says so — so pause is emulated: stop the engine and remember WHICH PIECE
// was being spoken; resume speaks again from the start of that piece and queues
// the rest. Pieces are sentence-sized (READ_PIECE_CHARS), so resuming repeats at
// most a sentence or two. The engine reports each piece's start (with the id that
// speak() returned), which is how the current piece is known. If events can't be
// set up, the position is unknown and resume restarts from the first piece instead
// of guessing. Replay is always "from the first piece".
//
//   idle -> starting -> reading <-> paused
//                          \-> done  (finished by itself; Replay available)
//   stop() from anywhere -> idle
import { splitForSpeech, type SpeechSettings } from "$lib/utils/speech";
import type { TtsBackend, TtsEvent } from "$lib/utils/ttsBackend";

export type ReadStatus = "idle" | "starting" | "reading" | "paused" | "done";
export type ReadState = { status: ReadStatus; id: string | null; chunkCount: number };
export type StartResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; message: string };

/** Largest piece read aloud. Small on purpose: pause/resume can only restart on a piece boundary. */
export const READ_PIECE_CHARS = 400;

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

  // what is being read
  private pieces: string[] = [];
  private entryId: string | null = null;

  // position tracking (from the engine's start events)
  private at = 0; // index of the piece last reported as started
  private located = false; // false until the first start event of this run arrives
  private idToIndex = new Map<string, number>();
  private earlyStarts = new Set<string>(); // start events that arrived before speak() returned their id
  private unlisten: (() => void) | null = null;
  private listening: Promise<void> | null = null;
  private eventsOk = true;

  constructor(private d: ControllerDeps) {}

  get current(): ReadState {
    return this.state;
  }

  private set(next: ReadState) {
    this.state = next;
    this.d.onChange(next);
  }

  // ------------------------------------------------------------- events
  private ensureListening(): Promise<void> {
    if (!this.listening) {
      this.listening = (async () => {
        try {
          this.unlisten = await this.d.backend.onEvent((e) => this.onEvent(e));
        } catch (err) {
          this.eventsOk = false;
          this.d.log?.(`read aloud: engine events unavailable (${describe(err)}) — resume will restart from the beginning`);
        }
      })();
    }
    return this.listening;
  }

  private onEvent(e: TtsEvent) {
    if (e.type !== "start" || !e.id) return;
    const index = this.idToIndex.get(e.id);
    if (index === undefined) {
      this.earlyStarts.add(e.id);
      return;
    }
    this.at = index;
    this.located = true;
  }

  private learnId(id: string | undefined, index: number) {
    if (!id) return;
    this.idToIndex.set(id, index);
    if (this.earlyStarts.delete(id)) {
      this.at = index;
      this.located = true;
    }
  }

  // ------------------------------------------------------------- running
  async start(id: string, text: string): Promise<StartResult> {
    const pieces = splitForSpeech(text, READ_PIECE_CHARS);
    if (pieces.length === 0) return { ok: false, message: "There's nothing to read in this one." };
    this.pieces = pieces;
    this.entryId = id;
    // Take the session number BEFORE waiting for the event relay: a Stop (or a newer
    // Start) that lands during that wait must win, not be overwritten when this
    // call carries on afterwards.
    const ticket = ++this.session;
    await this.ensureListening();
    if (ticket !== this.session) return { ok: false, cancelled: true };
    return this.run(0, ticket);
  }

  /** Submit pieces[from..] to the engine as one new session. */
  private async run(from: number, ticket?: number): Promise<StartResult> {
    const mine = ticket ?? ++this.session;
    // Local copies: stop() clears this.pieces/entryId, and the loop below must keep
    // working on (and be told to abandon) the session it started with.
    const pieces = this.pieces;
    const id = this.entryId as string;
    const { voiceId, rate, pitch } = this.d.settings();
    this.idToIndex.clear();
    this.earlyStarts.clear();
    this.at = from;
    this.located = false;
    this.set({ status: "starting", id, chunkCount: pieces.length });

    for (let i = from; i < pieces.length; i++) {
      if (mine !== this.session) return { ok: false, cancelled: true };
      try {
        const r = await this.d.backend.speak(pieces[i], { voiceId, rate, pitch, queue: i === from ? "flush" : "add" });
        if (r?.warning) this.d.log?.(`read aloud: ${r.warning}`);
        if (mine === this.session) this.learnId(r?.utteranceId, i);
      } catch (err) {
        if (mine !== this.session) return { ok: false, cancelled: true };
        const message = describe(err);
        this.d.log?.(`read aloud: piece ${i + 1}/${pieces.length} failed (${message})`);
        this.session++;
        await this.d.backend.stop().catch(() => {});
        this.clear();
        return { ok: false, message };
      }
      if (i === from) this.set({ status: "reading", id, chunkCount: pieces.length });
    }
    if (mine !== this.session) return { ok: false, cancelled: true };
    void this.watch(mine);
    return { ok: true };
  }

  /** Polls until the engine goes quiet (or the session is replaced / stopped / paused). */
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
        if (sawSpeaking) {
          // finished by itself: keep the pieces so Replay can read it again
          this.set({ status: "done", id: this.entryId, chunkCount: this.pieces.length });
        } else {
          this.clear();
          this.d.onNothingSpoken();
        }
        return;
      }
    }
  }

  private clear() {
    this.pieces = [];
    this.entryId = null;
    this.set(IDLE);
  }

  // ------------------------------------------------------------- controls
  /** Stop for good: the engine is told to stop and the session is forgotten. */
  async stop(): Promise<void> {
    this.session++;
    this.clear();
    await this.d.backend.stop().catch((err) => this.d.log?.(`read aloud: stop failed (${describe(err)})`));
  }

  /** Pause: stop the engine but remember where we were. No-op unless reading. */
  async pause(): Promise<void> {
    if (this.state.status !== "reading") return;
    this.session++; // silences the watcher and cancels a submission still in flight
    this.set({ status: "paused", id: this.entryId, chunkCount: this.pieces.length });
    await this.d.backend.stop().catch((err) => this.d.log?.(`read aloud: pause/stop failed (${describe(err)})`));
  }

  /** Resume from the start of the piece that was being spoken. No-op unless paused. */
  async resume(): Promise<StartResult | null> {
    if (this.state.status !== "paused") return null;
    const from = this.located && this.eventsOk ? this.at : 0;
    if (!(this.located && this.eventsOk)) this.d.log?.("read aloud: resume position unknown — restarting from the beginning");
    return this.run(Math.min(from, this.pieces.length - 1));
  }

  /** Read it all again from the first piece. Works while reading, paused or done. */
  async replay(): Promise<StartResult | null> {
    if (this.pieces.length === 0 || this.state.status === "idle") return null;
    return this.run(0);
  }

  /** Say a short sample with the current voice settings (flushes anything being read). */
  async preview(sample: string): Promise<{ ok: true } | { ok: false; message: string }> {
    this.session++;
    this.clear();
    const { voiceId, rate, pitch } = this.d.settings();
    try {
      await this.d.backend.speak(sample, { voiceId, rate, pitch, queue: "flush" });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }
}
