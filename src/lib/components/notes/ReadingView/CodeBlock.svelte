<script lang="ts">
  // A fenced code block: coloured by utils/codeHighlight.ts (plain text when the language is not known), with a Copy button.
  // The tokens are drawn as text inside <span>s, so the code can contain anything without ever becoming markup.
  import { highlight, normalizeLang } from "$lib/utils/codeHighlight";
  import { copyText } from "$lib/utils/copyText";
  import { pushToast } from "$lib/stores/toast.svelte";

  let { lang, code }: { lang: string; code: string } = $props();

  const tokens = $derived(highlight(code, lang));
  const label = $derived((lang.trim().split(/[\s,{]/)[0] ?? "").replace(/^\./, "").slice(0, 20));
  const known = $derived(normalizeLang(lang) !== null);

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
  <pre class="pre"><code>{#if tokens}{#each tokens as t}{#if t.k === "plain"}{t.v}{:else}<span class="tok-{t.k}">{t.v}</span>{/if}{/each}{:else}{code}{/if}</code></pre>
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
  .pre {
    margin: 0;
    padding: 0.85em 1em;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.84em;
    line-height: 1.55;
    tab-size: 4;
    white-space: pre;
    color: var(--rv-code-text);
    -webkit-user-select: text;
    user-select: text;
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
