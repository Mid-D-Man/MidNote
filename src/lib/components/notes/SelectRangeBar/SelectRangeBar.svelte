<script lang="ts">
  // The docked "Select text…" bar of the note editor: pick WHERE a selection starts and WHERE it ends by typing the
  // text (or a regex) at each end, instead of dragging handles across a long note. Opened from the Actions sheet; the
  // route page swaps it in for the formatting toolbar while it is open (they share the same bottom slot, exactly like
  // the find & replace bar), and the query fields live in the route page so they survive closing and reopening.
  //
  // While you type, the range is only HIGHLIGHTED (the editor's real selection and focus are never touched, so the
  // keyboard stays with the field). "Select" turns the highlighted range into the real selection and closes the bar:
  // the formatting toolbar, its AI sparkle, copy and so on then work on it like on any selection.
  //
  // All the logic is in selectRangeCore.ts / selectRangeExtension.ts. Effect safety (docs/svelte5-effect-safety.md):
  // the one $effect reads only `editor` and the query fields and writes only to ProseMirror (via dispatch, inside
  // untrack(), because the dispatch synchronously bumps NoteContent's `tick`).
  import { onDestroy, untrack } from "svelte";
  import type { Editor } from "@tiptap/core";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { describePlan } from "$lib/utils/selectRangeCore";
  import {
    setSelectRangeQuery,
    clearSelectRange,
    selectRangeNext,
    selectRangePrev,
    getSelectRangeInfo,
    commitSelectRange,
    scrollRangeIntoView,
    type RangeQuery,
  } from "$lib/utils/selectRangeExtension";

  let {
    editor,
    tick = 0,
    opts = $bindable(),
    height = $bindable(0),
    onClose,
    onSelected,
  }: {
    editor: Editor | null;
    // The same reactivity signal the find bar and the toolbar take: `editor` keeps its identity when its state changes.
    tick?: number;
    opts: { from: string; to: string; regex: boolean; caseSensitive: boolean; includeMarkers: boolean; endAt: "first" | "last" };
    height?: number;
    onClose: () => void;
    // Told after a range became the real selection (the page closes the bar and may show a hint).
    onSelected?: (range: { from: number; to: number }) => void;
  } = $props();

  let fromInput: HTMLInputElement | undefined = $state();
  let status = $state("");

  $effect(() => {
    fromInput?.focus();
    fromInput?.select();
  });

  const info = $derived.by(() => {
    tick;
    const ed = editor;
    if (!ed || ed.isDestroyed) return null;
    return getSelectRangeInfo(ed.state);
  });

  const query = $derived<RangeQuery>({
    from: opts.from,
    to: opts.to,
    regex: opts.regex,
    caseSensitive: opts.caseSensitive,
    includeMarkers: opts.includeMarkers,
    endAt: opts.endAt,
  });

  const isError = $derived(!status && !!info?.plan?.error);

  const statusText = $derived.by(() => {
    if (status) return status;
    if (!info || !info.active || !info.plan) return describePlan({ ranges: [], error: null, startCount: 0, endCount: 0, capped: false, timedOut: false, idle: true }, query, 0);
    return describePlan(info.plan, query, Math.max(0, info.current));
  });

  const canSelect = $derived(!!info && info.range !== null);

  function reveal() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    scrollRangeIntoView(ed.view, height);
  }

  // Push the query into the editor's plugin. Typing is debounced (a long note is re-scanned on every applied query);
  // a NEW editor instance (page switch) or two emptied fields apply immediately, so a highlight never lingers.
  let appliedEditor: Editor | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const ed = editor;
    const q: RangeQuery = {
      from: opts.from,
      to: opts.to,
      regex: opts.regex,
      caseSensitive: opts.caseSensitive,
      includeMarkers: opts.includeMarkers,
      endAt: opts.endAt,
    };
    if (!ed) return;
    const apply = () => {
      if (ed.isDestroyed) return;
      untrack(() => {
        setSelectRangeQuery(ed.view, q);
        appliedEditor = ed;
        status = "";
        reveal();
      });
    };
    if (ed !== appliedEditor || (q.from === "" && q.to === "")) apply();
    else timer = setTimeout(apply, 120);
    return () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  });

  onDestroy(() => {
    const ed = editor;
    if (ed && !ed.isDestroyed) clearSelectRange(ed.view);
  });

  function goNext() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("select bar: next range");
    selectRangeNext(ed.view);
    status = "";
    reveal();
  }
  function goPrev() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("select bar: previous range");
    selectRangePrev(ed.view);
    status = "";
    reveal();
  }

  function doSelect() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    // Rescan right now so the selection always matches the note as it is at this moment, even if the person typed in
    // the note while the bar was open and the debounce had not fired yet.
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setSelectRangeQuery(ed.view, query);
    const r = commitSelectRange(ed.view);
    if (!r) {
      status = "Nothing to select yet";
      return;
    }
    breadcrumb(`select bar: selected a range of ${r.to - r.from} positions`);
    onSelected?.(r);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canSelect) doSelect();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<div class="range-bar" role="search" aria-label="Select text between two texts" style="bottom: {getKeyboardInset()}px" bind:clientHeight={height}>
  <div class="row">
    <span class="label">From</span>
    <div class="field-wrap">
      <input
        bind:this={fromInput}
        bind:value={opts.from}
        class="field"
        type="text"
        placeholder="Start text (empty = start of page)"
        aria-label="Select from"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKeydown}
      />
      <div class="toggles">
        <button type="button" class="toggle mono" class:on={opts.regex} aria-pressed={opts.regex} aria-label="Use regular expression" onclick={() => (opts.regex = !opts.regex)}>.*</button>
        <button type="button" class="toggle" class:on={opts.caseSensitive} aria-pressed={opts.caseSensitive} aria-label="Match case" onclick={() => (opts.caseSensitive = !opts.caseSensitive)}>Aa</button>
      </div>
    </div>
    <button type="button" class="icon-btn" onclick={onClose} aria-label="Close select text">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
    </button>
  </div>

  <div class="row">
    <span class="label">To</span>
    <div class="field-wrap">
      <input
        bind:value={opts.to}
        class="field"
        type="text"
        placeholder="End text (empty = end of page)"
        aria-label="Select to"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKeydown}
      />
    </div>
    <button type="button" class="icon-btn" onclick={goPrev} aria-label="Previous range" disabled={!info || info.total < 2}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15" /></svg>
    </button>
    <button type="button" class="icon-btn" onclick={goNext} aria-label="Next range" disabled={!info || info.total < 2}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
    </button>
  </div>

  <div class="row options">
    <button type="button" class="chip" class:on={opts.includeMarkers} aria-pressed={opts.includeMarkers} aria-label="Include the start and end text" onclick={() => (opts.includeMarkers = !opts.includeMarkers)}>
      Include texts
    </button>
    <button type="button" class="chip" class:on={opts.endAt === "last"} aria-pressed={opts.endAt === "last"} aria-label="Stop at the last end text" onclick={() => (opts.endAt = opts.endAt === "last" ? "first" : "last")}>
      To last end
    </button>
    <button type="button" class="text-btn primary" onclick={doSelect} aria-label="Select this range" disabled={!canSelect}>Select</button>
  </div>

  <div class="status" class:error={isError} aria-live="polite">{statusText}</div>
</div>

<style>
  .range-bar {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    padding-bottom: max(var(--space-2), env(safe-area-inset-bottom));
    background: var(--surface-raised);
    border-top: 1px solid var(--hairline);
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.28);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .label {
    flex-shrink: 0;
    width: 34px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-lo);
  }
  .field-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }
  .field {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    height: 38px;
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-3);
  }
  .field-wrap:has(.toggles) .field {
    padding-right: 64px;
  }
  .field::placeholder {
    color: var(--text-faint);
  }
  .field:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .toggles {
    position: absolute;
    right: 3px;
    display: flex;
    gap: 1px;
  }
  .toggle {
    width: 28px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .toggle.mono {
    font-family: var(--font-mono);
  }
  .toggle.on {
    background: var(--accent);
    color: var(--bg);
  }
  .icon-btn {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--surface);
  }
  .icon-btn:disabled,
  .text-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .options {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .chip {
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 16px;
    color: var(--text-lo);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .text-btn {
    flex-shrink: 0;
    margin-left: auto;
    height: 36px;
    padding: 0 var(--space-4);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  .text-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .status {
    min-height: 15px;
    padding: 0 var(--space-1);
    font-size: 11px;
    line-height: 15px;
    color: var(--text-lo);
  }
  .status.error {
    color: var(--danger);
  }
</style>
