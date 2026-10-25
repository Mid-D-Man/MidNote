// Word / character counting for the note Actions sheet's "Word count". Pure string logic: no DOM, no Svelte, so
// it can be tested on its own.
//
// What counts as a word (the same on every device, deliberately NOT Intl.Segmenter, whose answers differ between
// engines): text split on whitespace AND on em / en dashes (fiction is full of "word—word" typed without spaces,
// and a word counter that calls those one word undercounts a manuscript), keeping only pieces that contain at
// least one letter or digit. So "—", "***" and "..." are not words, "well-known" and "3.14" are one word each.
// Chinese / Japanese text has no spaces: each Han / kana character counts as one word, the usual convention.
// Sentences are approximate on purpose ("Mr. Smith" counts as two): a count of full stops, not a grammar parser.

export const READING_WPM = 238;
export const SPEAKING_WPM = 130;

export interface TextStats {
  words: number;
  characters: number; // with spaces, line breaks not counted
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number; // non-empty lines
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/u;
const CJK_G = new RegExp(CJK.source, "gu");
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
const DASHES = /[\u2013\u2014\u2015]/g;
const SENTENCE_END = /[.!?\u2026]+["'\u201d\u2019)\]]*(?=\s|$)/g;
const ENDS_WITH_TERMINATOR = /[.!?\u2026]["'\u201d\u2019)\]]*\s*$/;

export function countWords(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const token of text.replace(DASHES, " ").split(/\s+/u)) {
    if (!token) continue;
    if (!CJK.test(token)) {
      if (HAS_WORD_CHAR.test(token)) n++;
      continue;
    }
    // Pull every CJK character out as its own piece; what is left between them counts as ordinary words.
    for (const part of token.replace(CJK_G, (m) => ` ${m} `).split(/\s+/u)) {
      if (part && HAS_WORD_CHAR.test(part)) n++;
    }
  }
  return n;
}

function countSentencesInLine(line: string): number {
  if (!HAS_WORD_CHAR.test(line)) return 0;
  const ends = line.match(SENTENCE_END)?.length ?? 0;
  return ends + (ENDS_WITH_TERMINATOR.test(line) ? 0 : 1);
}

export function textStats(text: string): TextStats {
  const clean = (text ?? "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n");
  let paragraphs = 0;
  let sentences = 0;
  for (const line of lines) {
    if (!HAS_WORD_CHAR.test(line)) continue;
    paragraphs++;
    sentences += countSentencesInLine(line);
  }
  const flat = clean.replace(/\n/g, "");
  return {
    words: countWords(clean),
    characters: Array.from(flat).length,
    charactersNoSpaces: Array.from(flat.replace(/\s/gu, "")).length,
    sentences,
    paragraphs,
  };
}

/** Checklist items reach plain text as "[ ] text" / "[x] text" (see htmlToPlainText): the box is not a word. */
export function stripChecklistMarks(text: string): string {
  return text.replace(/^([ \t]*)\[[ xX]\][ \t]/gm, "$1");
}

/** "—" for nothing, "< 1 min", "7 min", "1 h 5 min". */
export function formatMinutes(words: number, wpm: number): string {
  if (words <= 0) return "—";
  const minutes = words / wpm;
  if (minutes < 1) return "< 1 min";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function addStats(a: TextStats, b: TextStats): TextStats {
  return {
    words: a.words + b.words,
    characters: a.characters + b.characters,
    charactersNoSpaces: a.charactersNoSpaces + b.charactersNoSpaces,
    sentences: a.sentences + b.sentences,
    paragraphs: a.paragraphs + b.paragraphs,
  };
}

export const EMPTY_STATS: TextStats = { words: 0, characters: 0, charactersNoSpaces: 0, sentences: 0, paragraphs: 0 };
