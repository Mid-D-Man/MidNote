<script lang="ts">
  // Round 26 — the docked find & replace bar for the note editor.
  //
  // Opened from the "Find & replace" row in the note header's Actions
  // sheet (the route page swaps this in for FormattingToolbar while it's
  // open — they share the same bottom slot, so they never overlap).
  //
  // Deliberately a docked bar, NOT a Sheet: the whole point is watching
  // the highlights in the note while you tweak the query, and a Sheet's
  // scrim would cover exactly that. It's positioned the same way
  // FormattingToolbar is (fixed, lifted by getKeyboardInset()) so it
  // rides above the on-screen keyboard.
  //
  // All the real work — matching, highlighting, replacing — lives in
  // findReplaceExtension.ts / findReplaceCore.ts (tested against a real
  // Tiptap editor). This file is only the UI: it holds the query fields,
  // pushes the query into the editor's plugin (debounced while typing),
  // and calls next/prev/replace. It never touches the editor's selection
  // or focus, so the keyboard stays with whichever field you're in.
  //
  // Effect safety (docs/svelte5-effect-safety.md): the one $effect here
  // reads only `editor` and the four query fields and writes only to
  // ProseMirror (via dispatch) and `status`, which it never reads. The
  // dispatch synchronously bumps NoteContent's `tick`, so the whole apply
  // step runs inside untrack().
  import { onDestroy, untrack } from "svelte";
  import type { Editor } from "@tiptap/core";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import {
    setFindQuery,
    clearFind,
    findNext,
    findPrev,
    replaceCurrent,
    replaceAll,
    getFindInfo,
    scrollCurrentMatchIntoView,
    type FindOptions,
  } from "$lib/utils/findReplaceExtension";

  let {
    editor,
    tick = 0,
    opts = $bindable(),
    height = $bindable(0),
    onClose,
  }: {
    editor: Editor | null;
    // Same reactivity signal FormattingToolbar takes: `editor` doesn't
    // change identity when its state does, so match counts/undo state
    // re-derive off this.
    tick?: number;
    // Lives in the route page (not here) so the query survives closing
    // and reopening the bar within a note.
    opts: { find: string; replace: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean };
    // The bar's rendered height — the page pads the note's scroll area
    // by it so the last lines can still be scrolled above the bar.
    height?: number;
    onClose: () => void;
  } = $props();

  let findInput: HTMLInputElement | undefined = $state();
  let status = $state("");

  $effect(() => {
    findInput?.focus();
    findInput?.select();
  });

  const info = $derived.by(() => {
    tick;
    const ed = editor;
    if (!ed || ed.isDestroyed) return null;
    return getFindInfo(ed.state);
  });

  const isError = $derived(!status && !!opts.find && !!info?.error);

  const countText = $derived.by(() => {
    if (status) return status;
    if (!opts.find || !info || !info.active) return "";
    if (info.error) return info.error;
    if (info.total === 0) return "No results";
    return `${info.current + 1} of ${info.total}${info.capped ? "+" : ""}${info.timedOut ? " (stopped early — slow pattern)" : ""}`;
  });

  const canUndo = $derived.by(() => {
    tick;
    const ed = editor;
    return ed && !ed.isDestroyed ? ed.can().undo() : false;
  });

  function reveal() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    scrollCurrentMatchIntoView(ed.view, height);
  }

  // Push the query into the editor's plugin. Typing is debounced (a big
  // note re-scans on every applied query); a NEW editor instance (page
  // switch — NoteContent rebuilds the editor) or an emptied field applies
  // immediately, so highlights never linger on the wrong page.
  let appliedEditor: Editor | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const ed = editor;
    const q: FindOptions = {
      find: opts.find,
      regex: opts.regex,
      caseSensitive: opts.caseSensitive,
      wholeWord: opts.wholeWord,
    };
    if (!ed) return;
    const apply = () => {
      if (ed.isDestroyed) return;
      untrack(() => {
        setFindQuery(ed.view, q);
        appliedEditor = ed;
        status = "";
        reveal();
      });
    };
    if (ed !== appliedEditor || q.find === "") apply();
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
    if (ed && !ed.isDestroyed) clearFind(ed.view);
  });

  function goNext() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("find bar: next");
    findNext(ed.view);
    status = "";
    reveal();
  }
  function goPrev() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("find bar: prev");
    findPrev(ed.view);
    status = "";
    reveal();
  }

  function describeAbort(aborted: "none" | "invalid" | "timeout" | null): string {
    if (aborted === "invalid") return "Fix the pattern first";
    if (aborted === "timeout") return "Pattern too slow — nothing changed";
    return "Nothing to replace";
  }

  function doReplaceOne() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("find bar: replace one");
    const r = replaceCurrent(ed.view, opts.replace);
    status = r.aborted === null ? "" : describeAbort(r.aborted);
    reveal();
  }
  function doReplaceAll() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("find bar: replace all");
    const r = replaceAll(ed.view, opts.replace);
    status = r.aborted === null ? `Replaced ${r.replaced}` : describeAbort(r.aborted);
  }
  function doUndo() {
    const ed = editor;
    if (!ed || ed.isDestroyed) return;
    breadcrumb("find bar: undo");
    // No .focus() on purpose — that would pull focus out of the field
    // you're typing in.
    ed.commands.undo();
    status = "";
  }

  function onFindKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) goPrev();
      else goNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
  function onReplaceKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      doReplaceOne();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<div
  class="find-bar"
  role="search"
  style="bottom: {getKeyboardInset()}px"
  bind:clientHeight={height}
>
  <div class="row">
    <div class="field-wrap">
      <input
        bind:this={findInput}
        bind:value={opts.find}
        class="field"
        type="text"
        placeholder="Find"
        aria-label="Find"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onFindKeydown}
      />
      <div class="toggles">
        <button
          type="button"
          class="toggle mono"
          class:on={opts.regex}
          aria-pressed={opts.regex}
          aria-label="Use regular expression"
          onclick={() => (opts.regex = !opts.regex)}>.*</button
        >
        <button
          type="button"
          class="toggle"
          class:on={opts.caseSensitive}
          aria-pressed={opts.caseSensitive}
          aria-label="Match case"
          onclick={() => (opts.caseSensitive = !opts.caseSensitive)}>Aa</button
        >
        <button
          type="button"
          class="toggle"
          class:on={opts.wholeWord}
          aria-pressed={opts.wholeWord}
          aria-label="Whole word"
          onclick={() => (opts.wholeWord = !opts.wholeWord)}
        >
          <span class="ww">ab</span>
        </button>
      </div>
    </div>
    <button type="button" class="icon-btn" onclick={goPrev} aria-label="Previous match" disabled={!info || info.total === 0}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15" /></svg>
    </button>
    <button type="button" class="icon-btn" onclick={goNext} aria-label="Next match" disabled={!info || info.total === 0}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
    </button>
    <button type="button" class="icon-btn" onclick={onClose} aria-label="Close find and replace">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
    </button>
  </div>

  <div class="row">
    <div class="field-wrap">
      <input
        bind:value={opts.replace}
        class="field"
        type="text"
        placeholder={opts.regex ? "Replace with ($1, \\n)" : "Replace with"}
        aria-label="Replace with"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onReplaceKeydown}
      />
    </div>
    <button type="button" class="text-btn" onclick={doReplaceOne} aria-label="Replace" disabled={!info || info.total === 0 || !!info.error}>Replace</button>
    <button type="button" class="text-btn" onclick={doReplaceAll} aria-label="Replace all" disabled={!info || info.total === 0 || !!info.error}>All</button>
    <button type="button" class="icon-btn" onclick={doUndo} aria-label="Undo last change" disabled={!canUndo}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
    </button>
  </div>

  <div class="status" class:error={isError} aria-live="polite">{countText}</div>
</div>

<style>
  .find-bar {
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
  /* Room on the right of the Find field for its inline toggles. */
  .field-wrap:has(.toggles) .field {
    padding-right: 92px;
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
  /* "ab" with an underline: the conventional whole-word glyph. */
  .ww {
    border-bottom: 2px solid currentColor;
    line-height: 1;
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
  .text-btn {
    flex-shrink: 0;
    height: 38px;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
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
