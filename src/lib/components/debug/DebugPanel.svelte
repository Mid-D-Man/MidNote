<script lang="ts">
  // Floating, always-available — bottom-left, out of the way of the
  // notes/todos formatting toolbar which lives bottom-center. Badges red
  // the moment a warn/error is captured so it's obvious something needs
  // a look without having to remember to check.
  import { page } from "$app/stores";
  import { logs, hasUnread, clearLogs } from "$lib/debug/log.svelte";

  let manualOpen = $state(false);
  let copied = $state(false);

  // On note/todo routes specifically, force a COMPACT, NON-BLOCKING strip
  // rather than the full modal panel — this is a direct workaround for
  // the bug currently being chased: the panel's own toggle button is one
  // of the buttons not responding on those routes, so waiting for a tap
  // to open it isn't an option there, and the full panel's scrim would
  // block testing the very buttons we're trying to watch. This effect
  // only reads $page.url.pathname and writes state, never reads that
  // state back, so it can't repeat the reads-what-it-writes loop bug
  // from earlier — different shape, checked deliberately given that
  // history.
  const pinned = $derived(
    $page.url.pathname.startsWith("/note/") || $page.url.pathname.startsWith("/todo/")
  );

  const fullOpen = $derived(manualOpen && !pinned);
  const recent = $derived([...logs].slice(-5).reverse());

  function toggle() {
    manualOpen = !manualOpen;
    if (manualOpen) hasUnread.value = false;
  }

  async function copyAll() {
    const text = logs
      .map((l) => `[${l.time}]${l.count > 1 ? ` (×${l.count})` : ""} ${l.level.toUpperCase()}: ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "(no logs captured)");
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard API can be unavailable in some webview contexts —
      // fail silently rather than adding another error to the log about
      // the error log itself.
    }
  }
</script>

{#if pinned}
  <!-- Compact, no scrim, doesn't intercept touches to anything else —
       purely informational while testing. -->
  <div class="strip">
    <div class="strip-header">
      <span>Debug ({logs.length}){hasUnread.value ? " ⚠" : ""}</span>
      <button onclick={copyAll}>{copied ? "Copied!" : "Copy all"}</button>
    </div>
    {#if recent.length === 0}
      <p class="strip-empty">No logs yet — try tapping something.</p>
    {:else}
      {#each recent as entry (entry.id)}
        <div class="strip-entry {entry.level}">
          <span class="time">{entry.time}</span>
          {#if entry.count > 1}<span class="repeat">×{entry.count}</span>{/if}
          <span class="msg">{entry.message}</span>
        </div>
      {/each}
    {/if}
  </div>
{:else}
  <button class="debug-fab" class:alert={hasUnread.value} onclick={toggle} aria-label="Debug panel">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="7" y="9" width="10" height="10" rx="2" />
      <path d="M7 12H3M21 12h-4M12 9V4M9 4h6M4.5 6.5 7 9M19.5 6.5 17 9M4.5 17.5 7 15M19.5 17.5 17 15" />
    </svg>
    {#if hasUnread.value}<span class="dot"></span>{/if}
  </button>
{/if}

{#if fullOpen}
  <div class="scrim" onclick={toggle} role="presentation"></div>
  <div class="panel">
    <div class="panel-header">
      <h2>Debug log <span class="count">({logs.length})</span></h2>
      <div class="panel-actions">
        <button onclick={copyAll}>{copied ? "Copied!" : "Copy all"}</button>
        <button onclick={clearLogs}>Clear</button>
        <button onclick={toggle} aria-label="Close">×</button>
      </div>
    </div>
    <div class="panel-body">
      {#if logs.length === 0}
        <p class="empty">No logs captured yet.</p>
      {:else}
        {#each [...logs].reverse() as entry (entry.id)}
          <div class="entry {entry.level}">
            <span class="time">{entry.time}</span>
            {#if entry.count > 1}<span class="repeat">×{entry.count}</span>{/if}
            <span class="msg">{entry.message}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .debug-fab {
    position: fixed;
    left: var(--space-4);
    bottom: max(var(--space-4), env(safe-area-inset-bottom));
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    color: var(--text-lo);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 150;
    cursor: pointer;
  }
  .debug-fab.alert {
    color: var(--danger);
    border-color: var(--danger);
  }
  .dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }

  /* Pinned strip — top of screen, below the safe area, above the app
     header. Deliberately small (max 5 recent lines + a scrollable list
     within its own max-height) so it can't cover the whole editor. */
  .strip {
    position: fixed;
    top: max(var(--space-2), env(safe-area-inset-top));
    left: var(--space-2);
    right: var(--space-2);
    max-height: 22vh;
    overflow-y: auto;
    background: rgba(10, 14, 31, 0.92);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    z-index: 200;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Click-through by default — this sits on top of the header
       (back/delete/save/export), and those are exactly the buttons
       being tested right now. Only the Copy button below opts back into
       being tappable. */
    pointer-events: none;
  }
  .strip-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-lo);
    font-weight: 600;
  }
  .strip-header button {
    pointer-events: auto;
    font-size: 10px;
    padding: 2px var(--space-2);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
  }
  .strip-empty {
    font-size: 11px;
    color: var(--text-faint);
    margin: var(--space-1) 0 0;
  }
  .strip-entry {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 4px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.04);
    border-left: 2px solid var(--hairline);
    overflow-wrap: break-word;
    word-break: break-word;
  }
  .strip-entry.warn {
    border-left-color: var(--accent-2);
  }
  .strip-entry.error {
    border-left-color: var(--danger);
  }

  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 16, 0.6);
    z-index: 160;
  }
  .panel {
    position: fixed;
    inset: 8vh var(--space-3) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    z-index: 170;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
  .panel-header {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--hairline);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .panel-header h2 {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--text-hi);
    margin: 0;
  }
  .count {
    color: var(--text-faint);
    font-weight: 400;
  }
  .panel-actions {
    display: flex;
    gap: var(--space-2);
  }
  .panel-actions button {
    font-size: 12px;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    cursor: pointer;
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .empty {
    text-align: center;
    color: var(--text-faint);
    font-size: 13px;
    padding: var(--space-6) 0;
  }
  .entry {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    border-left: 3px solid var(--hairline);
    overflow-wrap: break-word;
    word-break: break-word;
  }
  .entry.warn {
    border-left-color: var(--accent-2);
  }
  .entry.error {
    border-left-color: var(--danger);
  }
  .time {
    color: var(--text-faint);
    margin-right: var(--space-2);
  }
  .repeat {
    color: var(--accent-2);
    font-weight: 600;
    margin-right: var(--space-2);
  }
  .msg {
    color: var(--text-hi);
    white-space: pre-wrap;
  }
</style>
