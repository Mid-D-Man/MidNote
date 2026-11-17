<script lang="ts">
  // A fenced code block: coloured by utils/codeHighlight.ts (plain text when the language is not known), with a Copy button.
  // The tokens are drawn as text inside <span>s, so the code can contain anything without ever becoming markup.
  import { highlight, normalizeLang } from "$lib/utils/codeHighlight";
  import { copyText } from "$lib/utils/copyText";
  import { pushToast } from "$lib/stores/toast.svelte";

  let { lang, code, numbered = false }: { lang: string; code: string; numbered?: boolean } = $props();

  const tokens = $derived(highlight(code, lang));
  const label = $derived((lang.trim().split(/[\s,{]/)[0] ?? "").replace(/^\./, "").slice(0, 20));
  const known = $derived(normalizeLang(lang) !== null);
  // line numbers: one per line of the code, in a column beside it (not for a huge file: it would be thousands of lines of numbers)
  const MAX_NUMBERED_LINES = 20000;
  const gutter = $derived.by(() => {
    if (!numbered) return "";
    const n = code.split("\n").length;
    if (n > MAX_NUMBERED_LINES) return "";
    return Array.from({ length: n }, (_, i) => String(i + 1)).join("\n");
  });

  async function copy() {
    const ok = await copyText(code);
    pushToast(ok ? { title: "Code copied" } : { title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" });
  }
</script>

<div class="code-block" class:known>
  <div class="head">
    <span class="lang">{label || "code"}</span>
    <button type="button" class="copy" aria-label="Copy code" onclick={copy}>Copy</button>
  </div>
  <div class="body">
  {#if gutter}<pre class="gutter" aria-hidden="true">{gutter}</pre>{/if}
  <pre class="pre"><code>{#if tokens}{#each tokens as t}{#if t.k === "plain"}{t.v}{:else}<span class="tok-{t.k}">{t.v}</span>{/if}{/each}{:else}{code}{/if}</code></pre>
  </div>
</div>

<style>
  .code-block {
    margin: 0 0 1.1em;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--rv-code-bg);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 36px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--hairline);
    background: var(--rv-code-head);
  }
  .lang {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    color: var(--text-faint);
  }
  .copy {
    background: transparent;
    border: none;
    color: var(--text-lo);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .copy:active {
    background: var(--accent-wash);
  }
  .body {
    display: flex;
    align-items: stretch;
  }
  .pre,
  .gutter {
    margin: 0;
    padding: 0.85em 1em;
    font-family: var(--font-mono);
    /* --rv-code-zoom is set by ReadingView (A- / A+, pinch); both columns scale together so line numbers stay level with their lines */
    font-size: calc(0.84em * var(--rv-code-zoom, 1));
    line-height: 1.55;
    tab-size: 4;
    white-space: pre;
  }
  .pre {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    color: var(--rv-code-text);
    -webkit-user-select: text;
    user-select: text;
  }
  .gutter {
    flex: none;
    padding-right: 0.7em;
    text-align: right;
    color: var(--text-faint);
    border-right: 1px solid var(--hairline);
    -webkit-user-select: none;
    user-select: none;
  }
  .pre :global(.tok-kw) { color: var(--tok-kw); }
  .pre :global(.tok-type) { color: var(--tok-type); }
  .pre :global(.tok-fn) { color: var(--tok-fn); }
  .pre :global(.tok-str) { color: var(--tok-str); }
  .pre :global(.tok-num) { color: var(--tok-num); }
  .pre :global(.tok-com) { color: var(--tok-com); font-style: italic; }
  .pre :global(.tok-const) { color: var(--tok-const); }
  .pre :global(.tok-prop) { color: var(--tok-prop); }
  .pre :global(.tok-attr) { color: var(--tok-attr); }
  .pre :global(.tok-var) { color: var(--tok-var); }
  .pre :global(.tok-tag) { color: var(--tok-tag); }
  .pre :global(.tok-add) { color: var(--tok-add); }
  .pre :global(.tok-del) { color: var(--tok-del); }
  .pre :global(.tok-hunk) { color: var(--tok-hunk); }
</style>
