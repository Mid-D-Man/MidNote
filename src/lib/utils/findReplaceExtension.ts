// Note-editor find & replace (round 26) — the ProseMirror side.
// The string logic (regex compile, scanning, $1 expansion) lives in
// findReplaceCore.ts; this file maps it onto real document positions and
// owns the plugin state, the highlight decorations, and the replace
// operations. Read that file's header first for the semantics.
//
// How it fits the editor:
//   - One plugin instance per editor, registered through the FindReplace
//     extension in NoteContent.svelte. A note "page" is one editor
//     instance (NoteContent is rebuilt on page switch), so "works per
//     page" needs no extra plumbing — the bar just re-applies its query
//     when the editor instance changes.
//   - Everything is driven by transactions carrying a meta value, never
//     by touching the real selection. Deliberate: a real selection would
//     (a) flip NoteContent's `hasSelection`, which turns the ruled lines
//     off, and (b) tempt focus into the editor, which would pull the
//     keyboard away from the find field. The current match is a
//     decoration, and the bar scrolls it into view itself.
//   - Matching is per text block (per note line); see the core file.
//   - Every replace goes through ONE transaction with closeHistory, so
//     Replace all is a single undo step and never merges with typing
//     that happened just before it.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { compileFind, scanText, buildReplacement, type FindOptions } from "./findReplaceCore";

export type { FindOptions } from "./findReplaceCore";

// Highlights are capped (a pathological query like "e" on a huge note
// shouldn't create tens of thousands of DOM decorations); the COUNT is
// still exact up to MAX_COUNT. Replace all never uses the highlight cap.
const MAX_COUNT = 100_000;
const MAX_HIGHLIGHT = 1500;
// A JS regex can't be interrupted mid-exec, so this only bails out
// BETWEEN lines — it protects against a slow-but-finite pattern across a
// big note, not against one catastrophically backtracking line. Stated
// limit, see the round 26 design notes.
const SEARCH_BUDGET_MS = 400;
const REPLACE_BUDGET_MS = 4000;

export interface FindMatch {
  from: number;
  to: number;
}

interface FindPluginState {
  query: FindOptions | null;
  error: string | null;
  matches: FindMatch[];
  capped: boolean;
  timedOut: boolean;
  current: number; // index into matches, -1 when none
  deco: DecorationSet;
}

type FindMeta =
  | { type: "set"; query: FindOptions | null }
  | { type: "next" }
  | { type: "prev" }
  // Move "current" to the first match at/after pos in the NEW document —
  // used right after a single replace so the next match is one past the
  // text just inserted, never the inserted text itself.
  | { type: "anchor"; pos: number };

export const findKey = new PluginKey<FindPluginState>("midnoteFindReplace");

const EMPTY: FindPluginState = {
  query: null,
  error: null,
  matches: [],
  capped: false,
  timedOut: false,
  current: -1,
  deco: DecorationSet.empty,
};

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Hard breaks (Shift+Enter) are leaf inline nodes of size 1; feeding them
// in as "\n" keeps text offset === document offset inside a block, which
// is what lets a match index map straight onto a position.
function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

interface ScanResult {
  matches: FindMatch[];
  capped: boolean;
  timedOut: boolean;
}

function scanDoc(doc: PMNode, re: RegExp, budgetMs: number, maxMatches: number): ScanResult {
  const matches: FindMatch[] = [];
  let capped = false;
  let timedOut = false;
  const deadline = now() + budgetMs;
  doc.descendants((node, pos) => {
    if (capped || timedOut) return false;
    if (!node.isTextblock) return true; // lists etc. — keep descending
    const text = blockText(node);
    const start = pos + 1;
    const finished = scanText(re, text, (m) => {
      if (matches.length >= maxMatches) {
        capped = true;
        return false;
      }
      matches.push({ from: start + m.index, to: start + m.index + m[0].length });
    });
    if (finished && now() > deadline) timedOut = true;
    return false; // never descend into a textblock's inline content
  });
  return { matches, capped, timedOut };
}

// First index whose `from` is >= pos; wraps to 0 when none is.
function firstAtOrAfter(matches: FindMatch[], pos: number): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].from < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo === matches.length ? 0 : lo;
}

function buildDecos(doc: PMNode, matches: FindMatch[], current: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const add = (i: number) => {
    const m = matches[i];
    const isCurrent = i === current;
    if (m.to > m.from) {
      decos.push(
        Decoration.inline(m.from, m.to, {
          class: isCurrent ? "find-match find-match-current" : "find-match",
        })
      );
    } else {
      // Zero-length match (an anchor like ^ or $): nothing to paint, so
      // mark the spot with a thin caret-like widget.
      decos.push(
        Decoration.widget(
          m.from,
          () => {
            const el = document.createElement("span");
            el.className = isCurrent ? "find-caret find-caret-current" : "find-caret";
            return el;
          },
          { key: `find-caret-${m.from}${isCurrent ? "-cur" : ""}`, side: -1 }
        )
      );
    }
  };
  const limit = Math.min(matches.length, MAX_HIGHLIGHT);
  for (let i = 0; i < limit; i++) add(i);
  if (current >= limit) add(current);
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

function createFindPlugin(): Plugin<FindPluginState> {
  return new Plugin<FindPluginState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(findKey) as FindMeta | undefined;

        let query = prev.query;
        if (meta?.type === "set") query = meta.query && meta.query.find ? meta.query : null;
        if (!query) return prev === EMPTY ? prev : EMPTY;

        const rescan = meta?.type === "set" || tr.docChanged;

        if (rescan) {
          const compiled = compileFind(query);
          if (!compiled.re) return { ...EMPTY, query, error: compiled.error };
          const res = scanDoc(newState.doc, compiled.re, SEARCH_BUDGET_MS, MAX_COUNT);

          let anchor: number;
          if (meta?.type === "anchor") {
            anchor = meta.pos;
          } else if (prev.current >= 0 && prev.matches[prev.current]) {
            const prevFrom = prev.matches[prev.current].from;
            // Same doc (query edit): stay near where the user was, so
            // typing "fo" -> "foo" doesn't jump away. Doc edit: follow
            // the old current match through the change.
            anchor = tr.docChanged ? tr.mapping.map(prevFrom) : prevFrom;
          } else {
            anchor = newState.selection.from;
          }
          const current = res.matches.length ? firstAtOrAfter(res.matches, anchor) : -1;
          return {
            query,
            error: null,
            matches: res.matches,
            capped: res.capped,
            timedOut: res.timedOut,
            current,
            deco: buildDecos(newState.doc, res.matches, current),
          };
        }

        if (meta?.type === "next" || meta?.type === "prev") {
          const n = prev.matches.length;
          if (n === 0) return prev;
          let current: number;
          if (prev.current < 0) current = 0;
          else current = meta.type === "next" ? (prev.current + 1) % n : (prev.current - 1 + n) % n;
          return { ...prev, current, deco: buildDecos(newState.doc, prev.matches, current) };
        }

        if (meta?.type === "anchor" && prev.matches.length) {
          const current = firstAtOrAfter(prev.matches, meta.pos);
          return { ...prev, current, deco: buildDecos(newState.doc, prev.matches, current) };
        }

        // Selection-only transaction, same document: nothing to redo.
        return prev;
      },
    },
    props: {
      decorations(state) {
        return findKey.getState(state)?.deco ?? DecorationSet.empty;
      },
    },
  });
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [createFindPlugin()];
  },
});

// ---- read side --------------------------------------------------------

export interface FindInfo {
  active: boolean;
  error: string | null;
  total: number;
  current: number; // 0-based, -1 when there is no current match
  capped: boolean;
  timedOut: boolean;
}

export function getFindInfo(state: EditorState): FindInfo {
  const st = findKey.getState(state);
  if (!st || !st.query) {
    return { active: false, error: null, total: 0, current: -1, capped: false, timedOut: false };
  }
  return {
    active: true,
    error: st.error,
    total: st.matches.length,
    current: st.current,
    capped: st.capped,
    timedOut: st.timedOut,
  };
}

export function getCurrentMatch(state: EditorState): FindMatch | null {
  const st = findKey.getState(state);
  if (!st || st.current < 0) return null;
  return st.matches[st.current] ?? null;
}

// ---- write side -------------------------------------------------------

export function setFindQuery(view: EditorView, query: FindOptions | null): void {
  view.dispatch(view.state.tr.setMeta(findKey, { type: "set", query } satisfies FindMeta));
}

export function findNext(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findKey, { type: "next" } satisfies FindMeta));
}

export function findPrev(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findKey, { type: "prev" } satisfies FindMeta));
}

export function clearFind(view: EditorView): void {
  setFindQuery(view, null);
}

export interface ReplaceResult {
  replaced: number;
  // null = it ran. Otherwise why nothing (or nothing more) happened.
  aborted: null | "none" | "invalid" | "timeout";
}

// Inserts `text` over [from, to) keeping the formatting of what it
// replaces. Deliberately NOT tr.insertText: that prefers the state's
// stored marks, so a pending "bold" left over from typing would leak
// into every replacement.
function insertStyled(tr: Transaction, from: number, to: number, text: string): void {
  if (!text) {
    if (to > from) tr.delete(from, to);
    return;
  }
  const $from = tr.doc.resolve(from);
  // The marks of the first character being replaced (or, for a
  // zero-length insert, whatever an insert at that spot would inherit).
  // NOT $from.marksAcross($to): that one exists for deletions and drops
  // every non-inclusive mark that ends at the range end — which is ALL
  // of this editor's marks — so replacing a whole bold word would have
  // silently un-bolded it. Caught by the round 26 test suite.
  const after = to > from ? $from.nodeAfter : null;
  const marks = after ? after.marks : $from.marks();
  tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks));
}

// Replaces [from, to) with `replacement`, where a "\n" in the replacement
// splits the line (a new paragraph, or a new list item when inside one).
// Returns the position just after the inserted text in the updated doc.
function applyReplacement(tr: Transaction, from: number, to: number, replacement: string): number {
  const lines = replacement.split("\n");
  insertStyled(tr, from, to, lines[0]);
  let pos = from + lines[0].length;
  for (let i = 1; i < lines.length; i++) {
    const $p = tr.doc.resolve(pos);
    const parent = $p.depth >= 2 ? $p.node($p.depth - 1) : null;
    const inListItem = !!parent && (parent.type.name === "listItem" || parent.type.name === "taskItem");
    const depth = inListItem ? 2 : 1;
    // Round 29: a new checklist item starts UNchecked, whatever the item
    // it was split from was — split() would otherwise copy `checked`.
    const typesAfter =
      inListItem && parent!.type.name === "taskItem"
        ? [{ type: parent!.type, attrs: { ...parent!.attrs, checked: false } }, null]
        : undefined;
    tr.split(pos, depth, typesAfter);
    pos += 2 * depth;
    if (lines[i]) {
      insertStyled(tr, pos, pos, lines[i]);
      pos += lines[i].length;
    }
  }
  return pos;
}

export function replaceCurrent(view: EditorView, template: string): ReplaceResult {
  const st = findKey.getState(view.state);
  if (!st || !st.query || st.error || st.current < 0) return { replaced: 0, aborted: "none" };
  const match = st.matches[st.current];
  if (!match) return { replaced: 0, aborted: "none" };

  // Re-run the pattern at exactly this spot (sticky) to get the real
  // capture groups — the plugin state only keeps positions, not exec
  // results, so 100k matches don't mean 100k retained arrays.
  const compiled = compileFind(st.query, "y");
  if (!compiled.re) return { replaced: 0, aborted: "invalid" };
  const $from = view.state.doc.resolve(match.from);
  const text = blockText($from.parent);
  const offset = match.from - $from.start();
  compiled.re.lastIndex = offset;
  const m = compiled.re.exec(text);
  if (!m || m.index !== offset || m[0].length !== match.to - match.from) {
    return { replaced: 0, aborted: "none" }; // stale match — nothing safe to replace
  }

  const replacement = buildReplacement(st.query, template, m, text);
  const tr = closeHistory(view.state.tr);
  const endPos = applyReplacement(tr, match.from, match.to, replacement);
  // After a zero-length replace, a zero-length match (like `$`) can sit
  // exactly at endPos again — step one further so it isn't picked twice.
  tr.setMeta(findKey, { type: "anchor", pos: endPos + (m[0].length === 0 ? 1 : 0) } satisfies FindMeta);
  view.dispatch(tr);
  return { replaced: 1, aborted: null };
}

export function replaceAll(view: EditorView, template: string): ReplaceResult {
  const st = findKey.getState(view.state);
  if (!st || !st.query) return { replaced: 0, aborted: "none" };
  const query = st.query;
  const compiled = compileFind(query);
  if (!compiled.re) return { replaced: 0, aborted: "invalid" };
  const re = compiled.re;

  const ops: Array<{ from: number; to: number; text: string }> = [];
  const deadline = now() + REPLACE_BUDGET_MS;
  let timedOut = false;
  view.state.doc.descendants((node, pos) => {
    if (timedOut) return false;
    if (!node.isTextblock) return true;
    const text = blockText(node);
    const start = pos + 1;
    scanText(re, text, (m) => {
      ops.push({
        from: start + m.index,
        to: start + m.index + m[0].length,
        text: buildReplacement(query, template, m, text),
      });
    });
    if (now() > deadline) timedOut = true;
    return false;
  });
  // A partial replace-all would silently leave the note half-changed;
  // refusing outright is the honest failure.
  if (timedOut) return { replaced: 0, aborted: "timeout" };
  if (ops.length === 0) return { replaced: 0, aborted: "none" };

  const tr = closeHistory(view.state.tr);
  // Back to front: every operation only touches positions at/after its
  // own start, so the earlier (lower) matches keep valid positions
  // without any mapping.
  for (let i = ops.length - 1; i >= 0; i--) {
    applyReplacement(tr, ops[i].from, ops[i].to, ops[i].text);
  }
  view.dispatch(tr);
  return { replaced: ops.length, aborted: null };
}

// ---- DOM helper (untested outside a real browser) ----------------------

// Brings the current match into the visible part of the editor's scroll
// container, accounting for the keyboard (via visualViewport) and the
// docked find bar sitting over the bottom. Never touches selection or
// focus. Only scrolls when the match isn't already comfortably visible.
export function scrollCurrentMatchIntoView(view: EditorView, bottomObstructionPx: number): void {
  const m = getCurrentMatch(view.state);
  if (!m) return;
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(m.from);
  } catch {
    return;
  }
  let el: HTMLElement | null = view.dom.parentElement;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
    el = el.parentElement;
  }
  if (!el) return;
  const box = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const visibleTop = box.top + 16;
  const visibleBottom = Math.min(box.bottom, viewportBottom) - bottomObstructionPx - 16;
  if (visibleBottom <= visibleTop) return;
  if (coords.top >= visibleTop && coords.bottom <= visibleBottom) return;
  const target = visibleTop + (visibleBottom - visibleTop) * 0.35;
  el.scrollTop += coords.top - target;
}
