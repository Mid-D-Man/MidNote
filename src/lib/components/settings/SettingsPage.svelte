<script lang="ts">
  // Round 42 — the frame of every page under /settings: a header with a Back
  // button (one level up) and a scrolling body.
  //
  // Back uses the browser history when the user really came from `parent` (so
  // the phone's own back gesture and this button agree and history doesn't
  // pile up), and otherwise goes to `parent` directly (a page opened by
  // address, or after a restart).
  import type { Snippet } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let { title, parent = "/", children }: { title: string; parent?: string; children: Snippet } = $props();

  let cameFromParent = false;
  afterNavigate((nav) => {
    cameFromParent = nav.from?.url.pathname === parent;
  });

  function goBack() {
    breadcrumb(`settings: back from "${title}" to ${parent}`);
    if (cameFromParent) history.back();
    else void goto(parent, { replaceState: true });
  }
</script>

<div class="settings-page">
  <header class="bar">
    <Button variant="ghost" size="icon" aria-label="Back" onclick={goBack}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
    </Button>
    <h1>{title}</h1>
  </header>
  <main class="body">
    <div class="inner">{@render children()}</div>
  </main>
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 100vw;
    background: var(--bg);
    color: var(--text-hi);
  }
  .bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: calc(var(--space-3) + env(safe-area-inset-top, 0px)) var(--space-4) var(--space-3);
    background: var(--surface);
    border-bottom: 1px solid var(--hairline);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
  }
  .inner {
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
</style>
