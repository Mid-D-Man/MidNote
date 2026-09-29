<script lang="ts">
  // Round 29 — STUB for "chat with AI about this note", opened from the
  // note editor's Actions sheet (the Notion "Ask AI" reference).
  //
  // This is deliberately UI only. There is no AI backend in MidNote yet
  // (the Cloudflare AI / Gemini / Groq work is deferred until after the
  // settings hierarchy — see AiNoteCreator.svelte's TODO, which is the
  // same honest-stub approach). So nothing typed here leaves the device;
  // each message gets a visible notice saying so, rather than a
  // convincing fake reply that would be mistaken for a working feature.
  //
  // The seam for the real thing: `send()` below is the only place a
  // backend call belongs, and `noteTitle` is where the note's context
  // would come in (its content isn't passed yet on purpose — nothing
  // should be gathering a note's text for a feature that doesn't exist).
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let { open = $bindable(false), noteTitle = "" }: { open?: boolean; noteTitle?: string } = $props();

  type Msg = { id: number; role: "user" | "notice"; text: string };
  let messages = $state<Msg[]>([]);
  let draft = $state("");
  let nextId = 0;

  const NOT_CONNECTED = "AI chat isn't connected yet — this is a preview of the layout, nothing was sent anywhere.";

  function send() {
    const text = draft.trim();
    if (!text) return;
    breadcrumb("note ai chat (stub): message typed, not sent anywhere");
    messages.push({ id: nextId++, role: "user", text });
    messages.push({ id: nextId++, role: "notice", text: NOT_CONNECTED });
    draft = "";
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<Sheet bind:open side="bottom" title="Ask AI">
  <div class="chat">
    <p class="about">Chat about <strong>{noteTitle || "this note"}</strong></p>

    <div class="log" aria-live="polite">
      {#if messages.length === 0}
        <p class="empty">Ask for a summary, a rewrite, or ideas for this note. <span class="soon">Coming soon.</span></p>
      {:else}
        {#each messages as m (m.id)}
          <div class="bubble {m.role}">{m.text}</div>
        {/each}
      {/if}
    </div>

    <div class="composer">
      <input
        class="field"
        type="text"
        placeholder="Ask AI about this note…"
        aria-label="Message AI"
        autocomplete="off"
        bind:value={draft}
        onkeydown={onKeydown}
      />
      <button type="button" class="send" onclick={send} disabled={!draft.trim()} aria-label="Send message">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
    </div>
  </div>
</Sheet>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 260px;
  }
  .about {
    margin: 0;
    font-size: 13px;
    color: var(--text-lo);
    overflow-wrap: anywhere;
  }
  .about strong {
    color: var(--text-hi);
    font-weight: 600;
  }
  .log {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 40vh;
    overflow-y: auto;
  }
  .empty {
    margin: auto 0;
    text-align: center;
    font-size: 13px;
    color: var(--text-faint);
  }
  .soon {
    color: var(--accent);
    font-weight: 600;
  }
  .bubble {
    max-width: 85%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md, 12px);
    font-size: 14px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--accent);
    color: var(--bg);
  }
  .bubble.notice {
    align-self: flex-start;
    background: var(--surface);
    border: 1px dashed var(--hairline);
    color: var(--text-lo);
    font-size: 12px;
    font-style: italic;
  }
  .composer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .field {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 40px;
    padding: 0 var(--space-3);
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 999px;
  }
  .field:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .send {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
