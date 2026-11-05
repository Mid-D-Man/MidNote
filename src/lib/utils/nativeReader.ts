// Round T — read aloud that keeps going in the background, with a media notification.
//
// On Android the app can hand a whole reading to a foreground service (src-tauri/android-reader/kotlin/ReaderService.kt).
// That service owns the speech engine and the sentence-by-sentence loop, so reading goes on with the screen off or the
// app in the background, and the pull-down shade / lock screen show title, previous, pause / play, next, stop and a
// progress bar. This file is the page's side of it: it sends commands through window.MidNoteReader (ReaderBridge.kt) and
// mirrors the service's state into the same ReadState the "Reading aloud" bar already shows.
//
// WHY THE SERVICE AND NOT THE PAGE DRIVES THE LOOP: when the app goes to the background Android pauses the WebView, so a
// loop written in JavaScript stalls (and the plugin's events did not always reach the page even in the foreground).
//
// Where window.MidNoteReader is missing (a browser, an older build, desktop) nothing here is used and the app reads
// through readAloudController.ts and the TTS plugin exactly as before.
//
// Plain TypeScript, no Tauri import, no runes: tested in Node with a fake bridge.
import { READ_PIECE_CHARS, type ReadState, type ReadStatus, type StartResult } from "$lib/utils/readAloudController";
import { splitForSpeech, type SpeechSettings } from "$lib/utils/speech";

/** Separates pieces in the one string sent to the phone. A piece may hold line breaks, so a newline cannot do it. */
export const PIECE_SEPARATOR = "\u001e";

/** What window.MidNoteReader offers (ReaderBridge.kt). Numbers that are not whole are sent as text. */
export interface NativeReaderBridge {
  available(): string;
  start(id: string, title: string, pieces: string, index: number, voiceId: string, rate: string, pitch: string): void;
  pause(): void;
  resume(): void;
  replay(): void;
  stop(): void;
  seek(index: number): void;
  next(): void;
  previous(): void;
  settings(voiceId: string, rate: string, pitch: string): void;
  state(): string;
}

declare global {
  // Test seam only (jsdom has no Android): stands in for window.MidNoteReader.
  // eslint-disable-next-line no-var
  var __midnoteNativeReader: NativeReaderBridge | undefined;
  interface Window {
    MidNoteReader?: NativeReaderBridge;
    __midnoteReaderEvent?: (json: string) => void;
  }
}

const METHODS = ["available", "start", "pause", "resume", "replay", "stop", "seek", "next", "previous", "settings", "state"] as const;

/** The phone's reading service, or null when this app has none (browser, desktop, an older Android build). */
export function nativeReaderBridge(): NativeReaderBridge | null {
  const candidate = (globalThis.__midnoteNativeReader ?? (typeof window !== "undefined" ? window.MidNoteReader : undefined)) as unknown;
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return null;
  const b = candidate as Record<string, unknown>;
  for (const m of METHODS) if (typeof b[m] !== "function") return null;
  return candidate as NativeReaderBridge;
}

export type NativeStateEvent = { status: ReadStatus; id: string | null; index: number; count: number; message: string | null };

const STATUSES: readonly string[] = ["idle", "starting", "reading", "paused", "done"];

/** One event from the service, as text. Anything that is not exactly the shape the service sends is refused (null). */
export function parseReaderEvent(raw: unknown): NativeStateEvent | null {
  if (typeof raw !== "string") return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const e = o as Record<string, unknown>;
  if (e.type !== "state" || typeof e.status !== "string" || !STATUSES.includes(e.status)) return null;
  if (typeof e.index !== "number" || !Number.isInteger(e.index) || e.index < 0) return null;
  if (typeof e.count !== "number" || !Number.isInteger(e.count) || e.count < 0) return null;
  if (e.id !== null && typeof e.id !== "string") return null;
  if (e.message !== null && typeof e.message !== "string") return null;
  return { status: e.status as ReadStatus, id: e.id as string | null, index: e.index, count: e.count, message: e.message as string | null };
}

const IDLE: ReadState = { status: "idle", id: null, chunkCount: 0, index: 0 };

export interface NativeDeps {
  bridge: NativeReaderBridge;
  settings: () => SpeechSettings;
  onChange: (state: ReadState) => void;
  /** The service reported a problem (the reading is paused or over, and says why). */
  onFailure: (message: string) => void;
  log?: (msg: string) => void;
}

/** Same surface as ReadAloudController, so the store can use either. */
export class NativeReadAloud {
  private state: ReadState = IDLE;
  private detach: (() => void) | null = null;

  constructor(private d: NativeDeps) {}

  get current(): ReadState {
    return this.state;
  }

  private set(next: ReadState) {
    this.state = next;
    this.d.onChange(next);
  }

  /**
   * Start listening to the service and catch up with it: the app may have been paused, or reloaded, while it went on
   * reading. Safe to call twice.
   */
  attach(): void {
    if (this.detach) return;
    const handler = (json: string) => this.receive(json);
    window.__midnoteReaderEvent = handler;
    const visible = () => {
      if (document.visibilityState === "visible") this.sync();
    };
    document.addEventListener("visibilitychange", visible);
    this.detach = () => {
      if (window.__midnoteReaderEvent === handler) window.__midnoteReaderEvent = undefined;
      document.removeEventListener("visibilitychange", visible);
    };
    this.sync();
  }

  /** Ask the service where it is and show that. */
  sync(): void {
    try {
      this.receive(this.d.bridge.state());
    } catch (e) {
      this.d.log?.(`read aloud: could not ask the service for its state (${describe(e)})`);
    }
  }

  /** One event from the service. Unreadable events are dropped. */
  receive(json: unknown): void {
    const e = parseReaderEvent(json);
    if (!e) {
      this.d.log?.("read aloud: an unreadable event from the service was ignored");
      return;
    }
    this.set({ status: e.status, id: e.id, chunkCount: e.count, index: e.index });
    if (e.message) this.d.onFailure(e.message);
  }

  async start(id: string, text: string, title = ""): Promise<StartResult> {
    const pieces = splitForSpeech(text, READ_PIECE_CHARS).map((p) => p.split(PIECE_SEPARATOR).join(" "));
    if (pieces.length === 0) return { ok: false, message: "There's nothing to read in this one." };
    const s = this.d.settings();
    // show the bar at once; the service's own state replaces this as soon as it answers
    this.set({ status: "starting", id, chunkCount: pieces.length, index: 0 });
    try {
      this.d.bridge.start(id, title, pieces.join(PIECE_SEPARATOR), 0, s.voiceId ?? "", String(s.rate), String(s.pitch));
    } catch (e) {
      this.set(IDLE);
      return { ok: false, message: `The reading service didn't start (${describe(e)}).` };
    }
    this.d.log?.(`read aloud: handed ${pieces.length} piece(s) to the background service`);
    return { ok: true };
  }

  async pause(): Promise<void> {
    this.send(() => this.d.bridge.pause());
  }

  async resume(): Promise<StartResult | null> {
    this.send(() => this.d.bridge.resume());
    return null;
  }

  async replay(): Promise<StartResult | null> {
    this.send(() => this.d.bridge.replay());
    return null;
  }

  async seek(index: number): Promise<StartResult | null> {
    const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    this.send(() => this.d.bridge.seek(i));
    return null;
  }

  async stop(): Promise<void> {
    this.send(() => this.d.bridge.stop());
    // the service answers with "idle"; do not wait for it, so the bar closes at once and a lost event cannot leave it open
    this.set(IDLE);
  }

  /** Voice / speed / pitch changed in Settings: the pieces spoken from now on use them. */
  settingsChanged(): void {
    const s = this.d.settings();
    this.send(() => this.d.bridge.settings(s.voiceId ?? "", String(s.rate), String(s.pitch)));
  }

  private send(call: () => void) {
    try {
      call();
    } catch (e) {
      this.d.log?.(`read aloud: the service did not take that (${describe(e)})`);
    }
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
}
