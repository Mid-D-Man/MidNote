<script lang="ts">
  // Draws inline nodes (utils/markdown.ts) as real elements. Text goes in as TEXT, never as HTML.
  import type { Inline } from "$lib/utils/markdown";
  import { openExternal } from "$lib/utils/openLink";
  import ReadingInline from "./ReadingInline.svelte";

  let { nodes }: { nodes: Inline[] } = $props();

  function openLink(e: MouseEvent, href: string) {
    e.preventDefault();
    void openExternal(href);
  }
</script>

{#each nodes as n}{#if n.t === "text"}{n.v}{:else if n.t === "code"}<code class="rv-code">{n.v}</code>{:else if n.t === "strong"}<strong><ReadingInline nodes={n.c} /></strong>{:else if n.t === "em"}<em><ReadingInline nodes={n.c} /></em>{:else if n.t === "del"}<s><ReadingInline nodes={n.c} /></s>{:else if n.t === "ins"}<u><ReadingInline nodes={n.c} /></u>{:else if n.t === "link"}<a href={n.href} rel="noopener noreferrer" onclick={(e) => openLink(e, n.href)}><ReadingInline nodes={n.c} /></a>{:else if n.t === "image"}<span class="rv-image">Image{n.alt ? `: ${n.alt}` : ""}</span>{:else if n.t === "br"}<br />{/if}{/each}
