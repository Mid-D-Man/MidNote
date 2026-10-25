// "Select from … to …" for the note editor: the ProseMirror side. The string logic (finding the markers and pairing
// them into ranges) is in selectRangeCore.ts; this file turns the document into lines, keeps the result in a plugin
// (like find & replace does), previews the current range with a highlight, and finally makes it the REAL selection.
//
// Same design rules as findReplaceExtension.ts, for the same reasons:
//   - While the person is still typing the two texts, nothing touches the real selection or the focus: the range is
//     only a highlight (a decoration), so the keyboard stays with the field and the note's ruled lines stay on.
//   - Only an explicit "Select" turns it into a real selection (and focuses the editor so the handles and the
//     formatting toolbar, with its AI sparkle, are right there).
//   - One plugin instance per editor; a page switch rebuilds the editor, and the bar simply re-applies its query.
//   - The plugin rescans on every document change, so the highlight and the count never describe stale text.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { planRanges, type RangePlan, type RangeQuery, type SelRange, type TextBlock } from "./selectRangeCore";

export type { RangeQuery } from "./selectRangeCore";

interface SelectRangeState {
  query: RangeQuery | null;
  plan: RangePlan | null;
  current: number; // index into plan.ranges, -1 when none
  deco: DecorationSet;
}

type SelectRangeMeta = { type: "set"; query: RangeQuery | null } | { type: "next" } | { type: "prev" };

export const selectRangeKey = new PluginKey<SelectRangeState>("midnoteSelectRange");

const EMPTY: SelectRangeState = { query: null, plan: null, current: -1, deco: DecorationSet.empty };

// Hard breaks (Shift+Enter) are leaf nodes of size 1: feeding them in as "\n" keeps text offset === document offset
// inside a block, which is what lets a match index map straight onto a position (same trick as find & replace).
function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

export function collectBlocks(doc: PMNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ start: pos + 1, text: blockText(node) });
    return false;
  });
  return blocks;
}

function firstAtOrAfter(ranges: SelRange[], pos: number): number {
  for (let i = 0; i < ranges.length; i++) if (ranges[i].from >= pos) return i;
  return 0;
}

function buildDeco(doc: PMNode, plan: RangePlan | null, current: number): DecorationSet {
  const r = plan && current >= 0 ? plan.ranges[current] : null;
  if (!r) return DecorationSet.empty;
  return DecorationSet.create(doc, [Decoration.inline(r.from, r.to, { class: "range-preview" })]);
}

function createPlugin(): Plugin<SelectRangeState> {
  return new Plugin<SelectRangeState>({
    key: selectRangeKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, newState) {
        const meta = tr.getMeta(selectRangeKey) as SelectRangeMeta | undefined;

        let query = prev.query;
        if (meta?.type === "set") query = meta.query && (meta.query.from || meta.query.to) ? meta.query : null;
        if (!query) return prev === EMPTY ? prev : EMPTY;

        if (meta?.type === "next" || meta?.type === "prev") {
          const n = prev.plan?.ranges.length ?? 0;
          if (n === 0) return prev;
          const step = meta.type === "next" ? 1 : -1;
          const current = (prev.current + step + n) % n;
          return { ...prev, current, deco: buildDeco(newState.doc, prev.plan, current) };
        }

        if (meta?.type !== "set" && !tr.docChanged) {
          return prev.deco === DecorationSet.empty ? prev : { ...prev, deco: prev.deco.map(tr.mapping, tr.doc) };
        }

        const plan = planRanges(collectBlocks(newState.doc), query);
        let anchor: number;
        const prevRange = prev.plan && prev.current >= 0 ? prev.plan.ranges[prev.current] : null;
        if (prevRange && meta?.type !== "set") anchor = tr.mapping.map(prevRange.from);
        else if (prevRange) anchor = prevRange.from;
        else anchor = newState.selection.from;
        const current = plan.ranges.length ? firstAtOrAfter(plan.ranges, anchor) : -1;
        return { query, plan, current, deco: buildDeco(newState.doc, plan, current) };
      },
    },
    props: {
      decorations(state) {
        return selectRangeKey.getState(state)?.deco ?? DecorationSet.empty;
      },
    },
  });
}

export const SelectRange = Extension.create({
  name: "selectRange",
  addProseMirrorPlugins() {
    return [createPlugin()];
  },
});

function send(view: EditorView, meta: SelectRangeMeta): void {
  view.dispatch(view.state.tr.setMeta(selectRangeKey, meta).setMeta("addToHistory", false));
}

export function setSelectRangeQuery(view: EditorView, query: RangeQuery | null): void {
  send(view, { type: "set", query });
}
export function selectRangeNext(view: EditorView): void {
  send(view, { type: "next" });
}
export function selectRangePrev(view: EditorView): void {
  send(view, { type: "prev" });
}
export function clearSelectRange(view: EditorView): void {
  if (!view.isDestroyed && selectRangeKey.getState(view.state)?.query) send(view, { type: "set", query: null });
}

export interface SelectRangeInfo {
  active: boolean;
  plan: RangePlan | null;
  current: number;
  total: number;
  range: SelRange | null;
}

export function getSelectRangeInfo(state: EditorState): SelectRangeInfo {
  const s = selectRangeKey.getState(state);
  if (!s || !s.query) return { active: false, plan: null, current: -1, total: 0, range: null };
  const total = s.plan?.ranges.length ?? 0;
  return { active: true, plan: s.plan, current: s.current, total, range: s.current >= 0 && s.plan ? (s.plan.ranges[s.current] ?? null) : null };
}

/**
 * Make the previewed range the real selection and put the cursor in the editor, so its handles, the formatting
 * toolbar and the AI sparkle appear. The highlight is cleared in the same transaction. Returns the range, or null
 * when there was nothing to select. The range is validated against the CURRENT document, never trusted from earlier.
 */
export function commitSelectRange(view: EditorView): SelRange | null {
  const info = getSelectRangeInfo(view.state);
  const r = info.range;
  if (!r) return null;
  const size = view.state.doc.content.size;
  if (r.from < 0 || r.to > size || r.to <= r.from) return null;
  let tr = view.state.tr;
  try {
    tr = tr.setSelection(TextSelection.create(view.state.doc, r.from, r.to));
  } catch {
    return null;
  }
  tr = tr.setMeta(selectRangeKey, { type: "set", query: null } satisfies SelectRangeMeta).setMeta("addToHistory", false);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return r;
}

/** Scroll the start of the previewed range above the docked bar (the same rule the find bar uses for its matches). */
export function scrollRangeIntoView(view: EditorView, bottomObstructionPx: number): void {
  const r = getSelectRangeInfo(view.state).range;
  if (!r) return;
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(r.from);
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
