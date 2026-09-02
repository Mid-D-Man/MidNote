<script lang="ts">
  // Real contenteditable, not a <textarea> — a textarea has exactly one
  // font/weight/style for its entire content, so mixed formatting was
  // never achievable with one. note.content is an HTML string (still
  // just a `string` field — no schema change, see mdix_files/schema).
  //
  // REVISION NOTE (this file previously used bind:innerHTML={value} —
  // a two-way DOM binding — alongside imperative DOM surgery in
  // richText.ts (collapseOutsideFormatting) that repositions the live
  // Selection right after a format is applied. Those two don't mix.
  // bind:innerHTML writes `contentEl.innerHTML = value` any time `value`
  // changes for ANY reason, including the app's own explicit "read the
  // DOM back into state" lines (syncContentFromDom() in the page,
  // formerly also here). Reassigning .innerHTML destroys and reparses
  // the whole subtree — any live Selection pointing into the old nodes,
  // including the one collapseOutsideFormatting just carefully moved
  // outside a formatting span, is invalidated, and the browser's
  // recovery position after that isn't something the fix controls. This
  // is a well-documented category of bug for bind:innerHTML/contenteditable
  // specifically (Svelte's own tracker has repeat reports of cursor
  // position resetting on these bindings), not something specific to
  // this app, but the fix here is specific: stop using it as a live
  // two-way channel during editing.
  //
  // New contract: contentEl.innerHTML is the single source of truth
  // while a note is open. This component only ever WRITES to it
  // imperatively, gated by `syncToken` (bumped by the page on note
  // load, undo, and redo — the three moments an external value should
  // legitimately overwrite what's on screen). Ordinary typing/paste/
  // format-apply are one-directional DOM -> value reads only, via
  // `untrack()` on the syncToken effect so those reads never feed back
  // into a write. See docs/svelte5-effect-safety.md — same read/write
  // hazard that doc already covers, just arriving through bind:innerHTML's
  // implicit two-way sync instead of a hand-written $effect.
  //
  // Deliberately NOT auto-growing to fit content: fixed height + internal
  // scroll avoids a large paste forcing an expensive synchronous reflow.
  import { untrack } from "svelte";
  import { insertPlainText, wrapLastInsertedText, hasPendingFormats, emptyPendingFormats, stripHtml, type PendingFormats } from "$lib/utils/richText";
  import { noteLinesEnabled } from "$lib/stores/settings.svelte";

  let {
    value = $bindable(""),
    contentEl = $bindable(null),
    baseFontSize = 15,
    pendingFormats = emptyPendingFormats(),
    onAutoFormatApplied,
    syncToken = 0,
    hasSelection = false,
  }: {
    value?: string;
    contentEl?: HTMLDivElement | null;
    baseFontSize?: number;
    // Bold/italic/underline/strikethrough/fontSize/color/backgroundColor
    // currently toggled on with no selection — see richText.ts's header
    // comment for why this is explicit page-owned state rather than
    // left to the browser's own (on real-device testing, unreliable)
    // sticky-typing tracking.
    pendingFormats?: PendingFormats;
    // Reports where the caret ended up right after an auto-format wrap,
    // so the page can tell "selection changed because of my own wrap"
    // apart from "selection changed because the user tapped/arrowed
    // somewhere else" and only reset pending formats for the latter.
    onAutoFormatApplied?: (node: Node, offset: number) => void;
    // Bumped by the page exactly when `value` should be pushed INTO the
    // DOM: note load (id change) and undo/redo. NOT bumped by ordinary
    // typing or format application — those already live correctly in
    // the DOM and re-pushing them is exactly the destructive round-trip
    // described above. Read via untrack() below so this effect reacts
    // only to the token, never to `value` itself changing on its own.
    syncToken?: number;
    // Suppresses the ruled-paper background (below) while a real
    // selection is active — a live Selection highlight painted over
    // ruled lines is what "the line stuff doesn't go away when I
    // select text" referred to. Purely visual; has no effect on
    // pendingFormats/formatting logic.
    hasSelection?: boolean;
  } = $props();

  // note.content's default is now "<div><br></div>" (see storage.ts's
  // createNote), not "" — a raw length check would think that's not
  // empty and hide the placeholder on every new note. stripHtml()
  // correctly reads it as empty since <br> and an empty <div> both
  // contribute no text.
  const isEmpty = $derived(stripHtml(value).length === 0);

  // The only place `value` gets written INTO the DOM. Fires on mount
  // (contentEl just became available) and whenever the page bumps
  // syncToken (note load / undo / redo). `value` itself is read via
  // untrack so this does not also fire on every keystroke — same
  // untrack(() => note.content) idiom the page already uses for its
  // own undo-checkpoint baseline.
  $effect(() => {
    syncToken;
    if (!contentEl) return;
    contentEl.innerHTML = untrack(() => value);
  });

  // Runs after the browser has already inserted typed/pasted text.
  // Always reads the DOM back into `value` at the end — this is now the
  // ONLY thing keeping `value`/note.content in sync with ordinary typing,
  // since there's no bind:innerHTML doing it automatically any more.
  // Purely one-directional (DOM -> value); nothing here writes back to
  // contentEl.innerHTML, so there's nothing for this to destructively
  // undo.
  //
  // Typed as plain Event, not InputEvent: TypeScript's DOM lib only
  // types oninput as InputEvent for <input>/<textarea>, not a generic
  // contenteditable <div> — even though the browser does fire a real
  // InputEvent here. Cast at the point of use instead of fighting that.
  //
  // REVISION NOTE: this used to gate on `ie.data && ie.inputType?.startsWith("insert")`
  // — require BOTH a non-empty data string AND a well-formed "insert*"
  // inputType before ever calling wrapLastInsertedText. That's the spec
  // shape for a clean desktop-Chrome insertText event, but it's an
  // allow-list of a well-formed shape, and real keyboards — Samsung
  // Keyboard on Android WebView specifically has open, general-purpose
  // contenteditable bug reports independent of any framework — are not
  // guaranteed to produce it: `data` can come through null/empty on an
  // otherwise perfectly ordinary single-character keystroke. When that
  // happened, the old guard silently did nothing at all: no error, no
  // log, just no formatting, on every single keystroke — which matches
  // "bold/italic/underline/strikethrough do not work AT ALL" exactly.
  //
  // Flipped to a deny-list instead: only SKIP when this is positively
  // identifiable as a deletion or a history action, both of which
  // reliably self-report via inputType even when insertions don't
  // ("deleteContentBackward" etc. / "historyUndo" / "historyRedo" —
  // note MidNote's own undo/redo is a separate page-level stack that
  // doesn't dispatch native input events at all, but a WebView's own
  // built-in undo gesture could, so this stays excluded on principle).
  // Everything else that isn't IME composition is treated as a
  // candidate insertion. `ie.data`'s length is still used when present
  // (the common, correct case); when it's missing, this falls back to
  // wrapping exactly 1 character rather than doing nothing — right for
  // the overwhelmingly common case of a single keystroke, and bounded-
  // safe even when wrong: wrapLastInsertedText clamps to what's actually
  // there and simply no-ops if the assumption doesn't hold, not a crash
  // or data loss either way.
  //
  // NOT independently verifiable from this sandbox: jsdom doesn't
  // simulate a real WebView's IME/keyboard event sequence (it has no
  // execCommand at all — see richText.ts's header comment — and nothing
  // here drives actual on-screen-keyboard behavior either), so this is
  // the best-supported fix given the evidence (a real, general,
  // independently-documented Samsung-Keyboard-in-Android-WebView
  // contenteditable quirk class), not a confirmed root cause. Worth
  // checking the debug panel after this build for whether "toolbar:
  // bold tapped" is now actually followed by bold characters landing in
  // note.content, on-device.
  function oninput(e: Event) {
    if (!contentEl) return;
    const ie = e as InputEvent;
    if (ie.isComposing) {
      value = contentEl.innerHTML;
      return;
    }
    const isDeletion = !!ie.inputType && ie.inputType.startsWith("delete");
    const isHistory = ie.inputType === "historyUndo" || ie.inputType === "historyRedo";

    if (hasPendingFormats(pendingFormats) && !isDeletion && !isHistory) {
      const insertedLength = ie.data && ie.data.length > 0 ? ie.data.length : 1;
      const pos = wrapLastInsertedText(contentEl, insertedLength, pendingFormats);
      if (pos) onAutoFormatApplied?.(pos.node, pos.offset);
    }
    value = contentEl.innerHTML;
  }

  // Pasting from another app would otherwise drag in arbitrary nested
  // spans/colors/fonts that live in note.content forever. Force plain
  // text only, applying whatever's currently pending to it.
  function onpaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    insertPlainText(text, pendingFormats);
    if (contentEl) value = contentEl.innerHTML;
  }
</script>

<div
  bind:this={contentEl}
  contenteditable="true"
  {oninput}
  {onpaste}
  role="textbox"
  aria-multiline="true"
  aria-label="Note content"
  data-placeholder="Start typing..."
  class="note-content"
  class:empty={isEmpty}
  class:lined={noteLinesEnabled.value && !hasSelection}
  style="font-size: {baseFontSize}px; line-height: {Math.round(baseFontSize * 1.7)}px"
></div>

<style>
  .note-content {
    display: block;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    flex: 1;
    min-height: 0;
    outline: none;
    border: none;
    background: transparent;
    overflow-y: auto;
    overflow-wrap: break-word;
    word-break: break-word;
    color: var(--text-hi);
    font-family: var(--font-sans);
    padding: var(--space-2) 0 var(--space-6);
  }
  .note-content.empty::before {
    content: attr(data-placeholder);
    color: var(--text-faint);
    pointer-events: none;
  }
  .note-content :global(ul),
  .note-content :global(ol) {
    margin: 0 0 var(--space-2);
    padding-left: 1.4em;
  }
  .note-content :global(li) {
    margin: 2px 0;
  }

  /* Ruled-paper lines, toggled from Settings. Each paragraph the user
     creates by pressing Enter becomes its own <div> — this is Chromium's
     long-standing default contenteditable behavior, not something forced
     here via execCommand. Giving each of those its own border-bottom is
     what makes the rule line "reactive": a block's border sits at the
     bottom of its own box, which naturally already accounts for the
     tallest inline content inside it (a bigger font on part of that
     line makes the div taller, so the line the border draws moves down
     to match, with no measurement code needed at all — ordinary CSS box
     layout does this for free). This is only tested to the extent CSS
     box-model behavior is well-established platform knowledge; the
     interaction with contenteditable's line-wrapping on this specific
     WebView is still worth an on-device look.
     Known simplification, not a silent gap: this only covers actual
     typed paragraphs — it does not extend ruled lines into the blank
     space below the last paragraph, since that space has no element to
     attach a border to without either faking empty trailing divs or a
     separate fixed-grid background that can't perfectly line-align with
     variable-height real content above it. Left out rather than shipped
     half-aligned. */
  .note-content.lined :global(> div) {
    border-bottom: 1px solid var(--rule-color, rgba(150, 120, 60, 0.35));
  }
</style>
