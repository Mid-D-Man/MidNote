// Round 37 — read aloud: the pure parts. No Svelte, no Tauri, no timers, so
// everything that can go wrong with TEXT (what gets read, how it is cut into
// pieces the engine accepts, which settings are legal) is testable directly.
import type { Entry } from "$lib/types/entry";
import { htmlToPlainText } from "$lib/utils/richText";
import { describeEdge } from "$lib/utils/boardEdits";

// ------------------------------------------------------------------ limits
// The plugin rejects any single request over 10,000 UTF-8 BYTES, and Android's
// own TextToSpeech refuses a request longer than 4,000 CHARACTERS (UTF-16
// units). A piece must satisfy both. 2,400 characters can never exceed 7,200
// bytes (a UTF-16 unit is at most 3 bytes of UTF-8; an emoji is 2 units for 4
// bytes), so the character limit always binds first and the 8,000-byte limit is
// a backstop that only matters if the character limit is ever raised.
export const MAX_CHUNK_CHARS = 2400;
export const MAX_CHUNK_BYTES = 8000;

export function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

const fits = (s: string, maxChars: number, maxBytes: number) => s.length <= maxChars && utf8Bytes(s) <= maxBytes;

/** Cut one over-long run into pieces that fit, never inside a surrogate pair. */
function hardSplit(s: string, maxChars: number, maxBytes: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (cur && !fits(cur + ch, maxChars, maxBytes)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// Every character of a line lands in exactly one match: text up to and including
// its closing punctuation (and any closing quote/bracket), or a trailing run with
// no punctuation. The leading part is `*`, not `+`, so a stray "!!!" or "..." at
// the start of a line is a match of its own instead of being skipped over — the
// first version used `+` and silently dropped it (found by the property test).
const SENTENCE = /[^.!?\u3002\uFF01\uFF1F\u2026]*[.!?\u3002\uFF01\uFF1F\u2026]+["')\]\u201D\u2019]*\s*|[^.!?\u3002\uFF01\uFF1F\u2026]+$/g;

/** One line that is too long on its own -> sentences -> words -> characters. */
function breakLine(line: string, maxChars: number, maxBytes: number): string[] {
  if (fits(line, maxChars, maxBytes)) return [line];
  const pieces: string[] = [];
  for (const sentence of line.match(SENTENCE) ?? [line]) {
    const s = sentence.trim();
    if (!s) continue;
    if (fits(s, maxChars, maxBytes)) {
      pieces.push(s);
      continue;
    }
    let cur = "";
    for (const word of s.split(/\s+/)) {
      if (!fits(word, maxChars, maxBytes)) {
        if (cur) pieces.push(cur);
        cur = "";
        pieces.push(...hardSplit(word, maxChars, maxBytes));
        continue;
      }
      const joined = cur ? `${cur} ${word}` : word;
      if (fits(joined, maxChars, maxBytes)) cur = joined;
      else {
        pieces.push(cur);
        cur = word;
      }
    }
    if (cur) pieces.push(cur);
  }
  return pieces;
}

/**
 * Cut text into pieces the speech engine accepts, in order, packing as many
 * whole lines (then sentences) into each piece as fit. Nothing is dropped: the
 * pieces joined back together hold every non-blank character of the input.
 */
export function splitForSpeech(text: string, maxChars = MAX_CHUNK_CHARS, maxBytes = MAX_CHUNK_BYTES): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = "";
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    for (const piece of breakLine(line, maxChars, maxBytes)) {
      const joined = cur ? `${cur}\n${piece}` : piece;
      if (fits(joined, maxChars, maxBytes)) cur = joined;
      else {
        flush();
        cur = piece;
      }
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- the text
const END_PUNCT = /[.!?:;,\u3002\uFF01\uFF1F\u2026)"'\u201D\u2019\]]$/;

/** Engines run a heading straight into the next line unless something ends it, so a line without closing punctuation gets a full stop. */
export function asSentence(line: string): string {
  const t = line.trim();
  return !t || END_PUNCT.test(t) ? t : `${t}.`;
}

/**
 * Make saved text pleasant to hear: checklist marks become words, divider
 * lines and "--- Page 2 ---" markers stop being read as punctuation, bullet
 * glyphs vanish, a web address becomes the word "link", and every line ends
 * like a sentence.
 */
export function speechClean(text: string): string {
  const lines: string[] = [];
  for (const raw of text.replace(/\u00a0/g, " ").split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (/^[-=_*~\u2022\s]{3,}$/.test(line)) continue; // a divider
    line = line.replace(/^-{2,}\s*(.+?)\s*-{2,}$/, "$1"); // "--- Page 2 ---" -> "Page 2"
    line = line.replace(/^\[x\]\s*/i, "Done: ").replace(/^\[ \]\s*/, "");
    line = line.replace(/^[\u2022\-*]\s+/, "");
    line = line.replace(/https?:\/\/\S+/gi, "link").replace(/\s+/g, " ").trim();
    if (!line) continue;
    lines.push(asSentence(line));
  }
  return lines.join("\n");
}

/** What is read for an entry. Locked entries have no content to read; the caller refuses them first. */
export function entryToSpeechText(entry: Entry): string {
  const parts: string[] = [entry.title || "Untitled"];
  if (entry.type === "regular") {
    parts.push(htmlToPlainText(entry.content));
    entry.pages.forEach((p, i) => {
      parts.push(p.name || `Page ${i + 2}`, htmlToPlainText(p.content));
    });
  } else if (entry.type === "todo") {
    for (const category of entry.categories) {
      const steps = entry.steps.filter((s) => s.category === category);
      if (steps.length === 0) continue;
      parts.push(`Category: ${category}`);
      steps.forEach((s, i) => {
        parts.push(`Step ${i + 1}${s.done ? ", done" : ""}: ${s.title || "untitled"}`);
        if (s.content) parts.push(s.content);
      });
    }
    if (entry.annotations.length > 0) {
      parts.push("Notes");
      for (const a of entry.annotations) parts.push(a.content ? `${a.title}: ${a.content}` : a.title);
    }
  } else {
    const nameOf = new Map(entry.nodes.map((n) => [n.id, n.label || "Untitled"]));
    for (const n of entry.nodes) parts.push(n.body ? `${n.label || "Untitled"}: ${n.body}` : n.label || "Untitled");
    for (const e of entry.edges) parts.push(describeEdge(nameOf.get(e.source) ?? "Something", nameOf.get(e.target) ?? "something", e.label, e.directed, "speech"));
  }
  return speechClean(parts.join("\n"));
}

// ---------------------------------------------------------------- settings
export type SpeechSettings = { voiceId: string | null; rate: number; pitch: number };
export const DEFAULT_SPEECH: SpeechSettings = { voiceId: null, rate: 1, pitch: 1 };
export const RATE_RANGE = { min: 0.5, max: 2.5 } as const;
export const PITCH_RANGE = { min: 0.5, max: 1.5 } as const;

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : fallback;

/** Anything read back from storage (or a hand-edited file) -> a legal value. */
export function sanitizeSpeechSettings(raw: unknown): SpeechSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = typeof o.voiceId === "string" && o.voiceId.length > 0 && o.voiceId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(o.voiceId) ? o.voiceId : null;
  return { voiceId: id, rate: clamp(o.rate, RATE_RANGE.min, RATE_RANGE.max, 1), pitch: clamp(o.pitch, PITCH_RANGE.min, PITCH_RANGE.max, 1) };
}

// ------------------------------------------------------------------- voices
export type VoiceLike = { id: string; name: string; language: string };

/** "en-US" / "en_GB" -> "en". */
export const baseLanguage = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0] || "";

/** Human name for a language code ("fr" -> "French"), or the code itself where the platform can't say. */
export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The distinct languages among `voices`, sorted by name. */
export function languageChoices(voices: readonly VoiceLike[]): { code: string; label: string }[] {
  const codes = new Set<string>();
  for (const v of voices) {
    const c = baseLanguage(v.language);
    if (c) codes.add(c);
  }
  return [...codes].map((code) => ({ code, label: languageLabel(code) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The voices of one language ("all" = every voice), sorted by language then name. */
export function voicesFor(voices: readonly VoiceLike[], code: string): VoiceLike[] {
  return voices
    .filter((v) => code === "all" || baseLanguage(v.language) === code)
    .slice()
    .sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
}

/**
 * Which language the list should open on: the chosen voice's own language, else
 * the phone's, else everything. A language with no voices is never picked (an
 * empty list on open looks like "no voices installed").
 */
export function pickLanguage(voices: readonly VoiceLike[], selectedVoiceId: string | null, deviceLanguage: string | undefined): string {
  const have = new Set(voices.map((v) => baseLanguage(v.language)));
  const chosen = selectedVoiceId ? voices.find((v) => v.id === selectedVoiceId) : undefined;
  if (chosen) return baseLanguage(chosen.language);
  const device = baseLanguage(deviceLanguage ?? "");
  return device && have.has(device) ? device : "all";
}
