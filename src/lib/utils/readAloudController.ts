// Round 37/40/41 — runs one "read this aloud" session against a TtsBackend.
// Plain TypeScript (no runes, no Tauri import) so it can be driven in Node with
// a scripted backend; stores/readAloud.svelte.ts is the reactive wrapper.
//
// HOW A SESSION WORKS (round 41 — one piece at a time)
//   The text is cut into PIECES (speech.ts splitForSpeech, sentence-sized). The
//   controller gives the engine ONE piece, waits until that piece is over, then
//   gives it the next. So "where are we" is simply "which piece did we last hand
//   over" — it never depends on the engine telling us where it is.
//
//   (Rounds 37-40 queued every piece at once and learned the position from the
//   engine's "start" events. When those events don't reach the app — which is
//   what happened on the phone — Resume had no position and restarted from the
//   first piece. Tested against a simulated engine: with events it resumed
//   correctly, without them it restarted from the beginning every time.)
//
//   How a piece is known to be over:
//     1. the engine's "finish" event for that piece (fast, exact), or
//     2. when no engine event has EVER arrived in this app run: polling
//        is_speaking until it stays false (guarded by a time floor so a flaky
//        early "false" can't skip ahead), or
//     3. when events do arrive but one finish was lost: the same polling, but
//        only well after the piece should have ended.
//   A "cancel" for the piece we are waiting on means something else silenced the
//   engine (a call, a notification, another app taking audio): that PAUSES the
//   session at that piece instead of silently moving on or reporting "Finished".
//
//   The first piece of a run is sent in "flush" mode (cuts off whatever was
//   being said), later ones in "add" mode: if the engine is somehow still
//   finishing the previous piece, the next one waits behind it instead of
//   cutting it off.
//
// PAUSE / RESUME / REPLAY. Android's speech engine cannot pause (the plugin
// says so), so Pause stops the engine and keeps the index of the piece being
// spoken. Resume speaks again from the START of that piece and carries on.
// Pieces are short (READ_PIECE_CHARS), so resuming repeats at most a sentence
// or two. Replay is always "from the first piece".
//
//   idle -> starting -> reading <-> paused
//                          \-> done  (finished by itself; Replay available)
//   stop() from anywhere -> idle
import { splitForSpeech, type SpeechSettings } from "$lib/utils/speech";
import type { TtsBackend, TtsEvent } from "$lib/utils/ttsBackend";

export type ReadStatus = "idle" | "starting" | "reading" | "paused" | "done";
export type ReadState = { status: ReadStatus; id: string | null; chunkCount: number };
export type StartResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; message: string };

/** Largest piece read aloud. Small on purpose: Resume can only restart on a piece boundary. */
export const READ_PIECE_CHARS = 240;

export interface ControllerDeps {
  backend: TtsBackend;
  settings: () => SpeechSettings;
  sleep: (ms: number) => Promise<void>;
  onChange: (state: ReadState) => void;
  /** The session ended with nothing ever having been spoken. */
  onNothingSpoken: () => void;
  /** The session broke off AFTER it had started speaking (the engine reported an error). */
  onFailure?: (message: string) => void;
  /** Clock in ms; defaults to Date.now. Only used for sanity timers. */
  now?: () => number;
  log?: (msg: string) => void;
}

export const POLL_MS = 300;
/** is_speaking must stay false for this many polls in a row before a piece counts as over (no-events mode). */
const QUIET_POLLS = 3;
/** A piece the engine never started within this long was not spoken. */
const NO_START_MS = 6000;
/** Rough speaking speed at rate 1.0 — used ONLY for sanity floors, never for position. */
const EST_CPS = 15;

const IDLE: ReadState = { status: "idle", id: null, chunkCount: 0 };
const CANCELLED: StartResult = { ok: false, cancelled: true };

type PieceOutcome = "finished" | "interrupted" | "error" | "silent" | "gone";
type Signal = "finish" | "cancel" | "error";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ReadAloudController {
  private session = 0;
  private runningTicket = 0; // ticket of the newest run (pause/stop bump `session` but not this)
  private state: ReadState = IDLE;

  // what is being read
  private pieces: string[] = [];
  private entryId: string | null = null;
  /** Index of the piece being spoken (while paused: the piece Resume starts with). */
  private at = 0;

  // engine events (only a speed-up and a pause trigger — never the source of the position)
  private signals = new Map<string, Signal>(); // terminal event per utterance id
  private started = new Set<string>();
  private eventsSeen = 0;
  private wake: (() => void) | null = null;
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

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  // ------------------------------------------------------------- events
  private ensureListening(): Promise<void> {
    if (!this.listening) {
      this.listening = (async () => {
        try {
          this.unlisten = await this.d.backend.onEvent((e) => this.onEvent(e));
        } catch (err) {
          this.eventsOk = false;
          this.d.log?.(`read aloud: engine events unavailable (${describe(err)}) — using polling`);
        }
      })();
    }
    return this.listening;
  }

  private onEvent(e: TtsEvent) {
    this.eventsSeen++;
    if (e.id) {
      if (e.type === "start") this.started.add(e.id);
      else if (e.type === "finish" || e.type === "cancel" || e.type === "error") this.signals.set(e.id, e.type);
    }
    this.wake?.();
  }

  private nextSignal(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
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
    if (ticket !== this.session) return CANCELLED;
    this.d.log?.(`read aloud: starting, ${pieces.length} piece(s), events ${this.eventsOk ? "registered" : "unavailable"}`);
    return this.run(0, ticket, true);
  }

  /**
   * Start feeding pieces[from..] to the engine. Resolves as soon as the FIRST piece
   * has been accepted (or failed); the rest of the session carries on in the
   * background and reports problems through onFailure / onNothingSpoken.
   */
  private run(from: number, mine: number, fresh: boolean): Promise<StartResult> {
    return new Promise<StartResult>((resolve) => {
      let settled = false;
      const settle = (r: StartResult) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      void this.loop(from, mine, fresh, settle).finally(() => settle(CANCELLED));
    });
  }

  private async loop(from: number, mine: number, fresh: boolean, settle: (r: StartResult) => void): Promise<void> {
    // Local copies: stop() clears this.pieces/entryId, and this loop must keep
    // working on (and be told to abandon) the session it started with.
    const pieces = this.pieces;
    const entry = this.entryId as string;
    this.runningTicket = mine;
    this.signals.clear();
    this.started.clear();
    this.at = from;
    // "starting" only the very first time; Resume/Replay go straight back to
    // "reading" so the bar doesn't flicker through a different layout.
    this.set({ status: fresh ? "starting" : "reading", id: entry, chunkCount: pieces.length });

    let spoke = false;
    for (let i = from; i < pieces.length; i++) {
      if (mine !== this.session) return;
      this.at = i;
      const { voiceId, rate, pitch } = this.d.settings();
      let utteranceId: string | undefined;
      try {
        const r = await this.d.backend.speak(pieces[i], { voiceId, rate, pitch, queue: i === from ? "flush" : "add" });
        if (r?.warning) this.d.log?.(`read aloud: ${r.warning}`);
        utteranceId = r?.utteranceId;
      } catch (err) {
        if (mine !== this.session) return;
        const message = describe(err);
        this.d.log?.(`read aloud: piece ${i + 1}/${pieces.length} failed (${message})`);
        this.session++;
        await this.d.backend.stop().catch(() => {});
        this.clear();
        if (i === from) settle({ ok: false, message });
        else this.d.onFailure?.(message);
        return;
      }
      if (mine !== this.session) {
        // Paused/stopped while this piece was in flight to the engine: it may have
        // landed after the engine was told to stop, so silence it again — unless a
        // newer run has taken over (its own first piece flushes this one anyway).
        if (this.runningTicket === mine) await this.d.backend.stop().catch(() => {});
        return;
      }
      if (i === from) {
        this.set({ status: "reading", id: entry, chunkCount: pieces.length });
        settle({ ok: true });
      }

      const outcome = await this.awaitPiece(utteranceId, pieces[i].length, rate, mine, i);
      if (outcome === "gone") return;
      if (outcome === "finished") {
        spoke = true;
        continue;
      }
      if (outcome === "silent") {
        if (!spoke && i === from) {
          this.d.log?.("read aloud: the engine never started speaking");
          this.session++;
          await this.d.backend.stop().catch(() => {});
          this.clear();
          this.d.onNothingSpoken();
          return;
        }
        this.d.log?.(`read aloud: piece ${i + 1}/${pieces.length} never started — moving on`);
        continue;
      }
      if (outcome === "interrupted") {
        // Something else took the audio (call, notification, another app). Stay on
        // this piece; Resume says it again.
        this.d.log?.(`read aloud: interrupted by the system at piece ${i + 1}/${pieces.length} — paused`);
        this.session++;
        this.set({ status: "paused", id: entry, chunkCount: pieces.length });
        await this.d.backend.stop().catch(() => {});
        return;
      }
      // outcome === "error"
      this.d.log?.(`read aloud: engine reported an error at piece ${i + 1}/${pieces.length}`);
      this.session++;
      await this.d.backend.stop().catch(() => {});
      this.clear();
      this.d.onFailure?.("The speech engine reported an error.");
      return;
    }
    if (mine !== this.session) return;
    this.d.log?.("read aloud: finished");
    // finished by itself: keep the pieces so Replay can read it again
    this.set({ status: "done", id: entry, chunkCount: pieces.length });
  }

  /** Waits until the engine has finished the piece it was just given. */
  private async awaitPiece(id: string | undefined, chars: number, rate: number, mine: number, index: number): Promise<PieceOutcome> {
    const t0 = this.now();
    const estMs = Math.max(1500, (chars / (EST_CPS * Math.max(0.25, rate))) * 1000);
    let sawSpeaking = false;
    let quiet = 0;
    for (;;) {
      if (mine !== this.session) return "gone";
      if (id) {
        const sig = this.signals.get(id);
        if (sig) {
          this.signals.delete(id);
          if (sig === "finish") return "finished";
          return sig === "cancel" ? "interrupted" : "error";
        }
        if (this.started.has(id)) sawSpeaking = true;
      }

      const woken = await Promise.race([this.d.sleep(POLL_MS).then(() => false), this.nextSignal().then(() => true)]);
      if (mine !== this.session) return "gone";
      if (woken) continue; // an engine event: look at the signals again

      let speaking = false;
      try {
        speaking = await this.d.backend.isSpeaking();
      } catch {
        speaking = false;
      }
      if (mine !== this.session) return "gone";
      if (speaking) {
        sawSpeaking = true;
        quiet = 0;
      } else if (sawSpeaking) {
        quiet++;
      }

      const elapsed = this.now() - t0;
      if (!sawSpeaking && elapsed > NO_START_MS) return "silent";

      const eventsAlive = this.eventsOk && this.eventsSeen > 0;
      if (eventsAlive) {
        // Events are the authority (they arrive at the real end of the piece, before
        // this could). The poll only rescues a finish that got lost, and only well
        // after the piece should have ended.
        if (quiet >= QUIET_POLLS && elapsed >= estMs + 2000) {
          this.d.log?.(`read aloud: piece ${index + 1} finish event missing — moved on by polling`);
          return "finished";
        }
      } else if (sawSpeaking && quiet >= QUIET_POLLS && elapsed >= estMs * 0.75) {
        // No engine event has ever arrived: judge by is_speaking alone.
        if (index === 0 || index % 10 === 0) this.d.log?.(`read aloud: piece ${index + 1} ended (by polling — no engine events received)`);
        return "finished";
      }
    }
  }

  private clear() {
    this.pieces = [];
    this.entryId = null;
    this.at = 0;
    this.set(IDLE);
  }

  // ------------------------------------------------------------- controls
  /** Stop for good: the engine is told to stop and the session is forgotten. */
  async stop(): Promise<void> {
    this.session++;
    this.clear();
    await this.d.backend.stop().catch((err) => this.d.log?.(`read aloud: stop failed (${describe(err)})`));
  }

  /** Pause: stop the engine but remember which piece it was on. No-op unless starting/reading. */
  async pause(): Promise<void> {
    if (this.state.status !== "reading" && this.state.status !== "starting") return;
    this.session++; // silences the waiter and cancels a submission still in flight
    this.d.log?.(`read aloud: paused at piece ${this.at + 1}/${this.pieces.length} (engine events seen: ${this.eventsSeen})`);
    this.set({ status: "paused", id: this.entryId, chunkCount: this.pieces.length });
    await this.d.backend.stop().catch((err) => this.d.log?.(`read aloud: pause/stop failed (${describe(err)})`));
  }

  /** Resume from the start of the piece that was being spoken. No-op unless paused. */
  async resume(): Promise<StartResult | null> {
    if (this.state.status !== "paused" || this.pieces.length === 0) return null;
    const from = Math.max(0, Math.min(this.at, this.pieces.length - 1));
    this.d.log?.(`read aloud: resuming at piece ${from + 1}/${this.pieces.length}`);
    return this.run(from, ++this.session, false);
  }

  /** Read it all again from the first piece. Works while reading, paused or done. */
  async replay(): Promise<StartResult | null> {
    if (this.pieces.length === 0 || this.state.status === "idle") return null;
    return this.run(0, ++this.session, false);
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
