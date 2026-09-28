// Pure string-side logic for the note editor's find & replace (round 26).
// No ProseMirror, no DOM, no Svelte in here on purpose — everything that
// can be decided from a string and a query lives in this file so it can
// be tested standalone; findReplaceExtension.ts is the thin layer that
// maps these results onto real document positions.
//
// Design decisions (agreed before building, see the round 26 thread):
//   - Full JavaScript RegExp semantics — lookarounds, backreferences,
//     named groups — NOT the RE2-style subset Tiptap's own find/replace
//     extension offers. That subset can't expand $1 in a replacement,
//     which is the whole reason this feature exists.
//   - Matching runs per text block (one note "line" = one block), so
//     ^ and $ mean line start / line end, exactly what you'd expect in a
//     note. The `m` flag is always on so ^/$ also respect a Shift+Enter
//     hard break inside a block (the extension feeds hard breaks in as
//     "\n").
//   - Zero-length matches are real matches (replace `^` with "- " to
//     bullet every line; replace `$` to append to every line).
//   - Replacement templates only mean anything in REGEX mode: $1, $&,
//     $<name>, $$, plus \n (new line), \t and \\ . In plain mode the
//     replacement is inserted literally, so replacing "$5" with "$6"
//     never surprises anyone.

export interface FindOptions {
  find: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface CompiledFind {
  re: RegExp | null;
  // Human-readable reason the pattern didn't compile. null when the
  // pattern is fine OR simply empty (empty is "nothing to search", not
  // an error).
  error: string | null;
}

const WORD_CLASS = "[\\p{L}\\p{N}_]";
const NOT_AFTER_WORD = `(?!${WORD_CLASS})`;
const NOT_BEFORE_WORD = `(?<!${WORD_CLASS})`;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordChar(ch: string): boolean {
  return /^[\p{L}\p{N}_]$/u.test(ch);
}

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // "Invalid regular expression: /(/: Unterminated group" -> "Unterminated group"
  const tail = msg.match(/:\s*([^:]+)$/);
  return (tail ? tail[1] : msg).trim();
}

// extraFlags: "y" for the sticky single-match re-exec replaceCurrent()
// does. Everything else is fixed: g (we always scan), m (per-line ^/$),
// i unless case-sensitive, u whenever it compiles.
export function compileFind(opts: FindOptions, extraFlags = ""): CompiledFind {
  if (!opts.find) return { re: null, error: null };

  let source = opts.regex ? opts.find : escapeRegExp(opts.find);

  if (opts.wholeWord) {
    if (opts.regex) {
      source = `${NOT_BEFORE_WORD}(?:${source})${NOT_AFTER_WORD}`;
    } else {
      // Only add a boundary on a side where the search text itself
      // starts/ends with a word character — "C++" whole-word must not
      // demand a word character after the final "+".
      const chars = Array.from(opts.find);
      const first = chars[0];
      const last = chars[chars.length - 1];
      source =
        (isWordChar(first) ? NOT_BEFORE_WORD : "") + source + (isWordChar(last) ? NOT_AFTER_WORD : "");
    }
  }

  const base = "gm" + (opts.caseSensitive ? "" : "i") + extraFlags;

  // Unicode mode first: `.` and character classes then treat an emoji as
  // ONE character instead of splitting its surrogate pair, and \p{..}
  // works. A few sloppy-but-valid non-unicode patterns (like a stray
  // escaped letter) are illegal under `u`, so retry without it — except
  // whole-word, whose boundary uses \p{..} and therefore needs `u`.
  try {
    return { re: new RegExp(source, base + "u"), error: null };
  } catch (firstErr) {
    if (opts.wholeWord) return { re: null, error: cleanError(firstErr) };
    try {
      return { re: new RegExp(source, base), error: null };
    } catch (secondErr) {
      return { re: null, error: cleanError(secondErr) };
    }
  }
}

// Walks every match of `re` in `text`, calling onMatch for each (return
// false from it to stop early). Handles the classic zero-length-match
// infinite loop by stepping past the empty match by one code point.
// Returns false if onMatch stopped it, true if it ran to the end.
export function scanText(
  re: RegExp,
  text: string,
  onMatch: (m: RegExpExecArray) => boolean | void
): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (onMatch(m) === false) return false;
    if (m[0].length === 0) {
      if (re.lastIndex >= text.length) break; // empty match at the very end — done
      const cp = text.codePointAt(re.lastIndex) ?? 0;
      re.lastIndex += cp > 0xffff ? 2 : 1;
    }
  }
  return true;
}

// Expands a REGEX-mode replacement template against one match, following
// String.prototype.replace's own substitution rules ($$, $&, $`, $',
// $n / $nn, $<name>) plus \n, \t and \\ . Captured text is only ever
// appended to the output, never re-scanned, so a match that itself
// contains "$1" or "\n" characters is copied as-is.
export function expandReplacement(template: string, m: RegExpExecArray, text: string): string {
  const nCaps = m.length - 1;
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const c = template[i];

    if (c === "\\" && i + 1 < template.length) {
      const n = template[i + 1];
      if (n === "n") { out += "\n"; i++; continue; }
      if (n === "t") { out += "\t"; i++; continue; }
      if (n === "\\") { out += "\\"; i++; continue; }
      out += c;
      continue;
    }

    if (c !== "$" || i === template.length - 1) {
      out += c;
      continue;
    }

    const n = template[i + 1];
    if (n === "$") { out += "$"; i++; }
    else if (n === "&") { out += m[0]; i++; }
    else if (n === "`") { out += text.slice(0, m.index); i++; }
    else if (n === "'") { out += text.slice(m.index + m[0].length); i++; }
    else if (n >= "0" && n <= "9") {
      let idx = 0;
      let consumed = 0;
      const n2 = template[i + 2];
      if (n2 !== undefined && n2 >= "0" && n2 <= "9") {
        const two = Number(n + n2);
        if (two >= 1 && two <= nCaps) { idx = two; consumed = 2; }
      }
      if (!consumed) {
        const one = Number(n);
        if (one >= 1 && one <= nCaps) { idx = one; consumed = 1; }
      }
      if (consumed) { out += m[idx] ?? ""; i += consumed; }
      else out += "$";
    } else if (n === "<") {
      const close = template.indexOf(">", i + 2);
      if (!m.groups || close === -1) { out += "$"; continue; }
      out += m.groups[template.slice(i + 2, close)] ?? "";
      i = close;
    } else {
      out += "$";
    }
  }
  return out;
}

// The one place that decides what a match turns into: regex mode expands
// the template, plain mode inserts it verbatim.
export function buildReplacement(
  opts: FindOptions,
  template: string,
  m: RegExpExecArray,
  text: string
): string {
  return opts.regex ? expandReplacement(template, m, text) : template;
}
