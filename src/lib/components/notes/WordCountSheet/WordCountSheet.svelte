<script lang="ts">
  // "Word count" in the note Actions sheet: words, characters, sentences, paragraphs, reading and speaking time for
  // the whole note (every page), a per-page breakdown when the note has several pages, and the same for the text that
  // is selected right now (handed in as a snapshot taken when the sheet was opened).
  //
  // The counts come from the note's own pages (note.content / note.pages[].content, which the editor keeps current as
  // you type), so nothing here needs the live editor. The title is not counted. All counting rules live in
  // utils/wordCount.ts (and are explained there); this file is only the layout. It computes only while open.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { htmlToPlainText } from "$lib/utils/richText";
  import {
    textStats,
    stripChecklistMarks,
    formatMinutes,
    addStats,
    EMPTY_STATS,
    READING_WPM,
    SPEAKING_WPM,
    type TextStats,
  } from "$lib/utils/wordCount";
  import type { Note } from "$lib/types/entry";

  let { open = $bindable(false), note, selectedText = "" }: { open?: boolean; note: Note; selectedText?: string } = $props();

  const nf = new Intl.NumberFormat();

  const pages = $derived.by(() => {
    if (!open) return [] as { label: string; stats: TextStats }[];
    const list = [{ label: note.page1Name || "Page 1", html: note.content }];
    note.pages.forEach((p, i) => list.push({ label: p.name || `Page ${i + 2}`, html: p.content }));
    return list.map((p) => ({ label: p.label, stats: textStats(stripChecklistMarks(htmlToPlainText(p.html ?? ""))) }));
  });

  const total = $derived(pages.reduce((acc, p) => addStats(acc, p.stats), EMPTY_STATS));
  const selected = $derived(open && selectedText.trim() ? textStats(selectedText) : null);
</script>

<Sheet bind:open side="bottom" title="Word count">
  <div class="wc">
    <div class="big">
      <div class="cell">
        <span class="num" aria-label="Words">{nf.format(total.words)}</span>
        <span class="cap">words</span>
      </div>
      <div class="cell">
        <span class="num" aria-label="Characters">{nf.format(total.characters)}</span>
        <span class="cap">characters</span>
      </div>
    </div>

    <dl class="rows">
      <div class="r"><dt>Characters (no spaces)</dt><dd>{nf.format(total.charactersNoSpaces)}</dd></div>
      <div class="r"><dt>Sentences</dt><dd>{nf.format(total.sentences)}</dd></div>
      <div class="r"><dt>Paragraphs</dt><dd>{nf.format(total.paragraphs)}</dd></div>
      <div class="r"><dt>Reading time</dt><dd>{formatMinutes(total.words, READING_WPM)}</dd></div>
      <div class="r"><dt>Speaking time</dt><dd>{formatMinutes(total.words, SPEAKING_WPM)}</dd></div>
    </dl>

    {#if selected}
      <section class="block" aria-label="Selected text">
        <h3>Selected text</h3>
        <div class="r"><dt>Words</dt><dd>{nf.format(selected.words)}</dd></div>
        <div class="r"><dt>Characters</dt><dd>{nf.format(selected.characters)}</dd></div>
        <div class="r"><dt>Reading time</dt><dd>{formatMinutes(selected.words, READING_WPM)}</dd></div>
      </section>
    {/if}

    {#if pages.length > 1}
      <section class="block" aria-label="By page">
        <h3>By page</h3>
        {#each pages as p, i (i)}
          <div class="r"><dt>{p.label}</dt><dd>{nf.format(p.stats.words)} words</dd></div>
        {/each}
      </section>
    {/if}

    <p class="fine">
      Counts the text of the note (not its title). A word is anything with a letter or number in it; words joined by a dash are
      counted separately. Sentences are approximate. Reading time assumes {READING_WPM} words a minute, speaking {SPEAKING_WPM}.
    </p>
  </div>
</Sheet>

<style>
  .wc {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
  }
  .big {
    display: flex;
    gap: var(--space-2);
  }
  .cell {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md, 12px);
  }
  .num {
    font-size: 30px;
    font-weight: 700;
    line-height: 1.1;
    color: var(--text-hi);
    font-variant-numeric: tabular-nums;
  }
  .cap {
    margin-top: 2px;
    font-size: 12px;
    color: var(--text-lo);
  }
  .rows,
  .block {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md, 12px);
  }
  .r {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    font-size: 14px;
    color: var(--text-hi);
  }
  .r + .r {
    border-top: 1px solid var(--hairline);
  }
  dt {
    color: var(--text-lo);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
    flex-shrink: 0;
  }
  h3 {
    margin: var(--space-2) 0 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-lo);
  }
  .fine {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--text-faint);
  }
</style>
