// Plain text that leaves the app (the clipboard, the share sheet, a .txt export) must contain only characters other
// tools accept. The note editor is a web page: typing two spaces in it, or opening a file with indentation, leaves
// NON-BREAKING SPACES (U+00A0) in the text, and some keyboards add zero-width marks. They look exactly like nothing, but
// DixScript's lexer (and plenty of other parsers: JSON, YAML, code) rejects them with "invalid character", so a file
// copied out of a note and pasted into GitHub failed to build. This is the one place that fixes it.
//
// Space-like characters become a plain space; characters that draw nothing are removed. NOT touched on purpose:
// U+200C / U+200D (they change how Persian, Indic scripts and emoji sequences are written) and the left-to-right /
// right-to-left marks (they keep Arabic and Hebrew punctuation in place). Plain TypeScript, no DOM.

// no-break space, figure space, narrow no-break space, and the en/em/thin/hair spaces plus the medium mathematical space
const SPACE_LIKE = /[\u00a0\u2000-\u200a\u202f\u205f]/g;
// soft hyphen, zero-width space, word joiner (+ the invisible math operators after it), byte-order mark / zero-width no-break space
const INVISIBLE = /[\u00ad\u200b\u2060-\u2064\ufeff]/g;

/** `text` with space-like characters turned into plain spaces and invisible ones removed. Returns the same string when there is nothing to fix. */
export function cleanPlainText(text: string): string {
  return text.replace(INVISIBLE, "").replace(SPACE_LIKE, " ");
}

/** How many characters cleanPlainText would change (for logs and tests). */
export function countInvisible(text: string): number {
  return (text.match(INVISIBLE)?.length ?? 0) + (text.match(SPACE_LIKE)?.length ?? 0);
}
