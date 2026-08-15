<script lang="ts">
  // Floating, always-available — bottom-left, out of the way of the
  // notes/todos formatting toolbar which lives bottom-center. Badges red
  // the moment a warn/error is captured so it's obvious something needs
  // a look without having to remember to check.
  import { logs, hasUnread, clearLogs } from "$lib/debug/log.svelte";

  let open = $state(false);
  let copied = $state(false);

  function toggle() {
    open = !open;
    if (open) hasUnread.value = false;
  }

  async function copyAll() {
    const text = logs
      .map((l) => `[${l.time}] ${l.level.toUpperCase()}: ${l.message}`)
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

<button class="debug-fab" class:alert={hasUnread.value} onclick={toggle} aria-label="Debug panel">
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="7" y="9" width="10" height="10" rx="2" />
    <path d="M7 12H3M21 12h-4M12 9V4M9 4h6M4.5 6.5 7 9M19.5 6.5 17 9M4.5 17.5 7 15M19.5 17.5 17 15" />
  </svg>
  {#if hasUnread.value}<span class="dot"></span>{/if}
</button>

{#if open}
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
  .msg {
    color: var(--text-hi);
    white-space: pre-wrap;
  }
</style>
