// Pure text-editing logic for the note formatting toolbar — kept
// separate from any Svelte/DOM code so it's plain, testable functions:
// given text + cursor position in, new text + cursor position out.
import { toRoman, fromRoman } from "./roman";

export type ListType = "bullet" | "decimal" | "roman";

interface LineInfo {
  line: string;
  lineStart: number;
  lineEnd: number; // exclusive, points at the \n or text.length
}

export function getLine(text: string, pos: number): LineInfo {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  let lineEnd = text.indexOf("\n", pos);
  if (lineEnd === -1) lineEnd = text.length;
  return { line: text.slice(lineStart, lineEnd), lineStart, lineEnd };
}

const BULLET_RE = /^(\s*)-\s/;
const DECIMAL_RE = /^(\s*)(\d+)\.\s/;
const ROMAN_RE = /^(\s*)([ivxlcdmIVXLCDM]+)\.\s/;

export interface ListMatch {
  type: ListType;
  indent: string;
  markerLength: number; // length of "N. " / "- " / "iv. " including trailing space
  value: number; // for decimal/roman, the numeric value; 0 for bullet
}

export function matchList(line: string): ListMatch | null {
  let m = line.match(DECIMAL_RE);
  if (m) return { type: "decimal", indent: m[1], markerLength: m[0].length, value: parseInt(m[2], 10) };

  m = line.match(ROMAN_RE);
  if (m) {
    const value = fromRoman(m[2]);
    if (value !== null) return { type: "roman", indent: m[1], markerLength: m[0].length, value };
  }

  m = line.match(BULLET_RE);
  if (m) return { type: "bullet", indent: m[1], markerLength: m[0].length, value: 0 };

  return null;
}

export function isLineListType(line: string, type: ListType): boolean {
  const match = matchList(line);
  return match !== null && match.type === type;
}

function markerFor(type: ListType, value: number): string {
  if (type === "bullet") return "- ";
  if (type === "decimal") return `${value}. `;
  return `${toRoman(value).toLowerCase()}. `;
}

// Enter was pressed — if the current line is a non-empty list item,
// continue the list on the new line with the next marker. If it's an
// EMPTY list item (just the marker, nothing typed after it), Enter exits
// the list instead: clears that line rather than adding a new marker,
// matching how most list-aware editors behave. Returns null when neither
// case applies, meaning: let Enter do its normal thing.
export function handleEnter(
  text: string,
  cursorPos: number
): { newText: string; newCursorPos: number } | null {
  const { line, lineStart, lineEnd } = getLine(text, cursorPos);
  const match = matchList(line);
  if (!match) return null;
  // Only auto-continue when the cursor is at the end of the line — if
  // they've moved the cursor back into the middle of list text and hit
  // enter there, that's a normal mid-line split, not "next item".
  if (cursorPos !== lineEnd) return null;

  const itemText = line.slice(match.indent.length + match.markerLength);
  if (itemText.trim() === "") {
    // Empty item — exit the list: remove this line's marker entirely.
    const newText = text.slice(0, lineStart) + text.slice(lineEnd);
    return { newText, newCursorPos: lineStart };
  }

  const nextMarker = match.indent + markerFor(match.type, match.value + 1);
  const insert = "\n" + nextMarker;
  const newText = text.slice(0, cursorPos) + insert + text.slice(cursorPos);
  return { newText, newCursorPos: cursorPos + insert.length };
}

// Toggle a list type on every line touched by the selection. If every
// touched line is already that type, remove the marker from all of them
// (toggle off). Otherwise, replace whatever marker each line has (if
// any) with this type's marker (switching types rather than stacking).
export function applyListFormat(
  text: string,
  selStart: number,
  selEnd: number,
  type: ListType
): { newText: string; newSelStart: number; newSelEnd: number } {
  const firstLineStart = getLine(text, selStart).lineStart;
  const lastLineInfo = getLine(text, selEnd);
  const blockEnd = lastLineInfo.lineEnd;

  const block = text.slice(firstLineStart, blockEnd);
  const lines = block.split("\n");

  const allAlreadyType = lines.every((l) => l.trim() === "" || isLineListType(l, type));
  let counter = 1;

  const newLines = lines.map((l) => {
    const existing = matchList(l);
    if (allAlreadyType) {
      // toggle off
      return existing ? l.slice(existing.indent.length + existing.markerLength) : l;
    }
    const indent = existing?.indent ?? "";
    const rest = existing ? l.slice(existing.indent.length + existing.markerLength) : l;
    const marker = indent + markerFor(type, counter);
    counter++;
    return marker + rest;
  });

  const newBlock = newLines.join("\n");
  const newText = text.slice(0, firstLineStart) + newBlock + text.slice(blockEnd);
  const delta = newBlock.length - block.length;
  return { newText, newSelStart: firstLineStart, newSelEnd: blockEnd + delta };
}

// --- Inline wraps: bold/italic/underline, toggle-aware. ---

export function isSelectionWrapped(text: string, selStart: number, selEnd: number, marker: string): boolean {
  if (selStart === selEnd) return false;
  const before = text.slice(Math.max(0, selStart - marker.length), selStart);
  const after = text.slice(selEnd, selEnd + marker.length);
  if (before !== marker || after !== marker) return false;
  // "*" and "**" share a character — a selection sitting just inside
  // "**bold**" would otherwise also read as "*"-wrapped, since the
  // character immediately before it IS a "*" (just the second one of a
  // pair). Reject the single-marker match when it's actually the inner
  // edge of a longer run of the same character.
  if (marker === "*") {
    const charBeforeThat = text[selStart - marker.length - 1];
    const charAfterThat = text[selEnd + marker.length];
    if (charBeforeThat === "*" || charAfterThat === "*") return false;
  }
  return true;
}

export function applyInlineWrap(
  text: string,
  selStart: number,
  selEnd: number,
  marker: string
): { newText: string; newSelStart: number; newSelEnd: number } {
  if (isSelectionWrapped(text, selStart, selEnd, marker)) {
    // toggle off — strip the marker on both sides
    const newText =
      text.slice(0, selStart - marker.length) + text.slice(selStart, selEnd) + text.slice(selEnd + marker.length);
    return { newText, newSelStart: selStart - marker.length, newSelEnd: selEnd - marker.length };
  }
  const selected = text.slice(selStart, selEnd);
  const newText = text.slice(0, selStart) + marker + selected + marker + text.slice(selEnd);
  return { newText, newSelStart: selStart + marker.length, newSelEnd: selEnd + marker.length };
}
