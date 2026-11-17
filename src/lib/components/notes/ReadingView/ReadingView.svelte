<script lang="ts">
  // Reading view: the note as a clean read-only page (headings, lists, tables, quotes, coloured code) instead of the editor.
  // It draws from the note's saved HTML: noteHtmlToMarkdown (the lines and the editor's own formatting) -> parseMarkdown
  // (a tree) -> real elements. Nothing is ever put on the page as HTML, and the note itself is never changed or saved here.
  // Colours, sizes and fonts chosen in the editor are not shown: this page has its own look.
  import { FORMAT_OPTIONS, blocksForFormat, formatLabel, type ReadingFormat } from "$lib/utils/readingFormat";
  import { noteFont } from "$lib/stores/settings.svelte";
  import { codeZoom, previewCodeZoom, saveCodeZoom, setCodeZoom } from "$lib/stores/readingView.svelte";
  import { ZOOM_MAX, ZOOM_MIN, blocksHaveCode, stepZoom, zoomPercent } from "$lib/utils/codeZoom";
  import { pinchOnCode } from "$lib/utils/pinchZoom";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import ReadingBody from "./ReadingBody.svelte";

  let {
    title,
    html,
    pageKey,
    format,
    bodyStyle = "",
    fontSize = 16,
    onEdit,
    onFormat,
    barHeight = $bindable(0),
  }: {
    title: string;
    html: string;
    /** Changes when another note or page is shown (starts the progressive drawing over). */
    pageKey: string;
    /** How the note is read: Markdown, plain text, JSON, a table, or code in some language (utils/readingFormat.ts). */
    format: ReadingFormat;
    bodyStyle?: string;
    fontSize?: number;
    onEdit: () => void;
    onFormat: (format: ReadingFormat) => void;
    barHeight?: number;
  } = $props();

  const blocks = $derived(blocksForFormat(html, format));
  const signature = $derived(`${pageKey}|${format}|${html.length}`);
  // code, JSON and tables use the full width; prose keeps a comfortable reading column
  const wide = $derived(format === "json" || format === "csv" || format.startsWith("code:"));
  // code size: A- / A+ in the bar (only when there is code to size) and a two-finger pinch on a code block
  const zoom = $derived(codeZoom.value);
  const hasCode = $derived(wide || blocksHaveCode(blocks));
  let pickerOpen = $state(false);
  function choose(f: ReadingFormat) {
    pickerOpen = false;
    onFormat(f);
  }
  const family = $derived(noteFont.value ? `${noteFont.value}, var(--font-sans)` : "var(--font-sans)");
</script>

<div class="reading-wrap">
  <div class="scroll" style={bodyStyle} data-testid="reading-scroll" use:pinchOnCode={{ get: () => codeZoom.value, onZoom: previewCodeZoom, onEnd: saveCodeZoom }}>
    <article class="doc" class:wide data-code-zoom={zoom} style="font-size: {fontSize}px; font-family: {family}; --rv-code-zoom: {zoom}">
      {#if title.trim()}<h1 class="doc-title">{title}</h1>{/if}
      {#key signature}
        <ReadingBody {blocks} />
      {/key}
      {#if blocks.length === 0}<p class="empty">Nothing here yet. Tap Edit to start writing.</p>{/if}
    </article>
  </div>
  <div class="bar" bind:offsetHeight={barHeight}>
    <button type="button" class="bar-btn primary" aria-label="Edit note" onclick={onEdit}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
      <span>Edit</span>
    </button>
    <button type="button" class="bar-btn on" aria-label="View as" aria-haspopup="dialog" onclick={() => (pickerOpen = true)}>
      <span class="dot" aria-hidden="true"></span>
      <span class="fmt">{formatLabel(format)}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {#if hasCode}
      <div class="zoom" role="group" aria-label="Code size ({zoomPercent(zoom)})">
        <button type="button" class="zbtn" aria-label="Smaller code" disabled={zoom <= ZOOM_MIN} onclick={() => setCodeZoom(stepZoom(zoom, -1))}>A<span aria-hidden="true">&minus;</span></button>
        <button type="button" class="zbtn" aria-label="Larger code" disabled={zoom >= ZOOM_MAX} onclick={() => setCodeZoom(stepZoom(zoom, 1))}>A<span aria-hidden="true">+</span></button>
      </div>
    {/if}
  </div>
</div>

<Sheet bind:open={pickerOpen} side="bottom" title="View as">
  <div class="picker">
    {#each ["Text", "Data", "Code"] as group}
      <p class="group">{group}</p>
      <div class="options">
        {#each FORMAT_OPTIONS.filter((o) => o.group === group) as o (o.id)}
          <button type="button" class="opt" class:current={o.id === format} aria-label="View as {o.label}" aria-pressed={o.id === format} onclick={() => choose(o.id)}>
            {o.label}
          </button>
        {/each}
      </div>
    {/each}
  </div>
</Sheet>

<style>
  .reading-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    /* syntax colours: dark first, light below */
    --rv-code-bg: #0b1020;
    --rv-code-head: #0f1530;
    --rv-code-text: #dfe3f5;
    --rv-link: #86a0ff;
    --rv-mark: rgba(201, 162, 75, 0.2);
    --tok-kw: #c4a7ff;
    --tok-type: #7dcfff;
    --tok-fn: #82aaff;
    --tok-str: #a5d6a7;
    --tok-num: #f2a65a;
    --tok-com: #6f7aa6;
    --tok-const: #f78c6c;
    --tok-prop: #89ddff;
    --tok-attr: #ffcb6b;
    --tok-var: #f07178;
    --tok-tag: #ff8fa3;
    --tok-add: #7ee787;
    --tok-del: #ff7b72;
    --tok-hunk: #79c0ff;
  }
  :global([data-theme="light"]) .reading-wrap {
    --rv-code-bg: #f3f5fc;
    --rv-code-head: #e9ecf8;
    --rv-code-text: #1c2140;
    --rv-link: var(--accent);
    --tok-kw: #6f42c1;
    --tok-type: #0b6e99;
    --tok-fn: #1d4ed8;
    --tok-str: #1a7f37;
    --tok-num: #b35900;
    --tok-com: #6e7781;
    --tok-const: #b4380f;
    --tok-prop: #0a6c8c;
    --tok-attr: #8a6100;
    --tok-var: #c2263a;
    --tok-tag: #c2185b;
    --tok-add: #1a7f37;
    --tok-del: #cf222e;
    --tok-hunk: #0550ae;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    /* only scrolling is left to the browser: a pinch on code is handled by pinchOnCode, never as a page zoom */
    touch-action: pan-x pan-y;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: var(--space-5) var(--space-4) var(--space-6);
  }
  .doc {
    max-width: 720px;
    margin: 0 auto;
    color: var(--text-hi);
    line-height: 1.7;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .doc-title {
    font-family: var(--font-display);
    font-size: 1.85em;
    line-height: 1.2;
    font-weight: 700;
    margin: 0 0 0.9em;
    padding-bottom: 0.45em;
    background: linear-gradient(90deg, var(--accent-2), transparent) bottom / 100% 1px no-repeat;
  }
  .doc.wide {
    max-width: none;
  }
  .empty {
    color: var(--text-faint);
    font-style: italic;
  }
  .doc :global(.rv-h) {
    font-family: var(--font-display);
    line-height: 1.25;
    font-weight: 700;
    margin: 1.5em 0 0.55em;
  }
  .doc :global(h1.rv-h) { font-size: 1.6em; }
  .doc :global(h2.rv-h) { font-size: 1.35em; padding-bottom: 0.25em; border-bottom: 1px solid var(--hairline); }
  .doc :global(h3.rv-h) { font-size: 1.15em; }
  .doc :global(h4.rv-h) { font-size: 1.02em; }
  .doc :global(h5.rv-h), .doc :global(h6.rv-h) { font-family: var(--font-sans); font-size: 0.88em; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-lo); }
  .doc > :global(.rv-h:first-child) { margin-top: 0; }
  .doc :global(.rv-p) { margin: 0 0 1em; white-space: pre-wrap; }
  .doc :global(a) { color: var(--rv-link); text-decoration: underline; text-underline-offset: 2px; }
  .doc :global(.rv-code) {
    font-family: var(--font-mono);
    font-size: 0.88em;
    padding: 0.12em 0.4em;
    border-radius: var(--radius-sm);
    background: var(--rv-code-bg);
    border: 1px solid var(--hairline);
  }
  .doc :global(.rv-image) {
    display: inline-block;
    padding: 0 0.5em;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    font-size: 0.9em;
  }
  .doc :global(.rv-quote) {
    margin: 0 0 1em;
    padding: 0.1em 0 0.1em 1em;
    border-left: 3px solid var(--accent-dim);
    color: var(--text-lo);
  }
  .doc :global(.rv-hr) {
    border: 0;
    border-top: 1px solid var(--hairline);
    margin: 1.6em 0;
  }
  .doc :global(.rv-list) {
    margin: 0 0 1em;
    padding-left: 1.5em;
  }
  .doc :global(.rv-list .rv-list) { margin: 0.2em 0 0.2em; }
  .doc :global(.rv-list > li) { margin: 0.2em 0; }
  .doc :global(.rv-list > li > .rv-p) { margin: 0; }
  .doc :global(.rv-list > li > .rv-p + .rv-p) { margin-top: 0.5em; }
  .doc :global(li.task) {
    list-style: none;
    margin-left: -1.5em;
    display: flex;
    align-items: flex-start;
    gap: 0.55em;
  }
  .doc :global(.task-body) { flex: 1; min-width: 0; }
  .doc :global(.task-body > .rv-p) { margin: 0; }
  .doc :global(.task-body > .rv-p + .rv-p) { margin-top: 0.5em; }
  .doc :global(.task-body.done) { color: var(--text-lo); text-decoration: line-through; }
  .doc :global(.box) {
    flex: none;
    box-sizing: border-box;
    width: 1.05em;
    height: 1.05em;
    margin-top: 0.3em;
    border: 2px solid var(--text-faint);
    border-radius: 4px;
    position: relative;
  }
  .doc :global(.box.on) { background: var(--accent); border-color: var(--accent); }
  .doc :global(.box.on::after) {
    content: "";
    position: absolute;
    left: 28%;
    top: 6%;
    width: 28%;
    height: 56%;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .doc :global(.rv-table-wrap) {
    overflow-x: auto;
    margin: 0 0 1.1em;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .doc :global(.rv-table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.93em;
    line-height: 1.5;
  }
  .doc :global(.rv-table th), .doc :global(.rv-table td) {
    padding: 0.5em 0.85em;
    border-bottom: 1px solid var(--hairline);
    text-align: left;
    vertical-align: top;
  }
  .doc :global(.rv-table th) { background: var(--surface-raised); font-weight: 700; white-space: nowrap; }
  .doc :global(.rv-table tbody tr:last-child td) { border-bottom: 0; }
  .doc :global(.rv-table tbody tr:nth-child(even) td) { background: var(--accent-wash); }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4) calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
    background: var(--surface);
    border-top: 1px solid var(--hairline);
  }
  .bar-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    color: var(--text-lo);
    font-size: 14px;
    white-space: nowrap; /* a button's name never wraps onto a second line ("Edi / t") */
    min-width: 0;
    cursor: pointer;
  }
  .bar-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  /* the format's name gives way (with an ellipsis) before anything else on a narrow screen */
  .fmt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar-btn.primary {
    flex: none;
  }
  .bar-btn .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--text-faint);
  }
  .zoom {
    display: inline-flex;
    gap: 2px;
    flex: none;
  }
  .zbtn {
    min-width: 34px;
    min-height: 40px;
    padding: 0 6px;
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    color: var(--text-hi);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .zbtn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .bar-btn.on { color: var(--text-hi); border-color: var(--accent-dim); }
  .bar-btn.on .dot { background: var(--accent); border-color: var(--accent); }
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4) var(--space-5);
    max-height: 70vh;
    overflow-y: auto;
  }
  .group {
    margin: var(--space-3) 0 0;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .opt {
    min-height: 40px;
    padding: 0 16px;
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    color: var(--text-hi);
    font-size: 14px;
    cursor: pointer;
  }
  .opt.current {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
</style>
