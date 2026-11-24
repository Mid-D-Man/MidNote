<script lang="ts">
  // Draws blocks (utils/markdown.ts) as real elements: headings, paragraphs, lists, quotes, tables, code. Calls itself for
  // anything nested (a list inside a list, a quote inside a quote).
  import type { Block } from "$lib/utils/markdown";
  import ReadingInline from "./ReadingInline.svelte";
  import CodeBlock from "./CodeBlock.svelte";
  import ReadingImage from "./ReadingImage.svelte";
  import ReadingBlocks from "./ReadingBlocks.svelte";

  let { blocks }: { blocks: Block[] } = $props();
</script>

{#each blocks as b}
  {#if b.t === "heading"}
    <svelte:element this={`h${b.level}`} class="rv-h"><ReadingInline nodes={b.c} /></svelte:element>
  {:else if b.t === "para"}
    <p class="rv-p"><ReadingInline nodes={b.c} /></p>
  {:else if b.t === "code"}
    <CodeBlock lang={b.lang} code={b.v} numbered={b.numbered ?? false} />
  {:else if b.t === "quote"}
    <blockquote class="rv-quote"><ReadingBlocks blocks={b.c} /></blockquote>
  {:else if b.t === "hr"}
    <hr class="rv-hr" />
  {:else if b.t === "list"}
    <svelte:element this={b.ordered ? "ol" : "ul"} class="rv-list" start={b.ordered ? b.start : undefined}>
      {#each b.items as it}
        {#if it.checked === null}
          <li><ReadingBlocks blocks={it.c} /></li>
        {:else}
          <li class="task">
            <span class="box" class:on={it.checked} role="checkbox" aria-checked={it.checked} aria-disabled="true" aria-label={it.checked ? "Done" : "Not done"}></span>
            <div class="task-body" class:done={it.checked}><ReadingBlocks blocks={it.c} /></div>
          </li>
        {/if}
      {/each}
    </svelte:element>
  {:else if b.t === "image"}
    <ReadingImage imageKey={b.key} alt={b.alt} />
  {:else if b.t === "section"}
    <section class="rv-section {b.kind}">
      {#if b.label}<p class="rv-section-label">{b.label}</p>{/if}
      <div class="rv-section-body"><ReadingBlocks blocks={b.c} /></div>
    </section>
  {:else if b.t === "table"}
    <div class="rv-table-wrap">
      <table class="rv-table">
        <thead>
          <tr>{#each b.head as cell, c}<th style:text-align={b.align[c] ?? undefined}><ReadingInline nodes={cell} /></th>{/each}</tr>
        </thead>
        <tbody>
          {#each b.rows as row}
            <tr>{#each row as cell, c}<td style:text-align={b.align[c] ?? undefined}><ReadingInline nodes={cell} /></td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/each}
