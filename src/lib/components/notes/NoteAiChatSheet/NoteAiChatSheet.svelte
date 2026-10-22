<script lang="ts">
  // Round G — chat with the AI about THIS note (the note editor's Actions -> Ask AI). It replaces the Round 29 stub.
  //
  // Every question sends the whole note (all its pages, as plain text) plus the conversation so far; the AI answers
  // from the note. The conversation lives in this component only: it is kept while the note stays open (close and
  // reopen the sheet and it is still here), and gone when you leave the note. Nothing is saved anywhere.
  //
  // An answer can be COPIED or ADDED to the page you are on (at its end, as real bullets/bold: one undo step). Nothing
  // in the note changes unless you tap Add. The first time, one notice says that the note text goes to the AI server
  // (the same acknowledgement as the selection sheet: utils/aiNotice.ts). State is written from handlers only
  // (docs/svelte5-effect-safety.md): there is no $effect here.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account } from "$lib/stores/account.svelte";
  import { ai, initAi, runAi } from "$lib/stores/ai.svelte";
  import { AI_LIMITS } from "$lib/online/aiClient";
  import { configProblemMessage } from "$lib/online/authMessages";
  import { aiNoticeSeen, markAiNoticeSeen } from "$lib/utils/aiNotice";
  import { clampNoteText, lastChatTurns } from "$lib/utils/aiNoteHtml";
  import { entryToPlainText } from "$lib/utils/selectionActions";
  import { copyText } from "$lib/utils/copyText";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { Note } from "$lib/types/entry";

  let {
    open = $bindable(false),
    note,
    onInsert,
  }: {
    open?: boolean;
    /** The live note (its content follows the editor, so unsaved edits are included). */
    note: Note;
    /** Adds an answer to the end of the page being edited; false when that wasn't possible. */
    onInsert?: (text: string) => boolean;
  } = $props();

  /** How many of the newest messages travel with each question (the server keeps only what fits, too). */
  const MAX_TURNS = 6;
  const SUGGESTIONS = ["Summarize this note.", "What are the key points?", "List any action items.", "Suggest improvements."];

  type Msg = { id: number; role: "user" | "assistant"; text: string; truncated: boolean };

  let messages = $state<Msg[]>([]);
  let draft = $state("");
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let credits = $state<{ charged: number | null; balance: number | null } | null>(null);
  let noticeSeen = $state(aiNoticeSeen());
  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");
  let nextId = 0;

  initAi();

  const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const ready = $derived(ai.configured && account.configured && account.signedIn);
  const canSend = $derived(ready && noticeSeen && !busy);
  // a failed question stays in the list; Try again re-asks it without adding it twice
  const canRetry = $derived(!busy && notice !== null && messages.length > 0 && messages[messages.length - 1].role === "user");

  function ackNotice() {
    markAiNoticeSeen();
    noticeSeen = true;
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || !canSend) return;
    messages.push({ id: nextId++, role: "user", text: q, truncated: false });
    draft = "";
    await run();
  }

  async function run() {
    busy = true;
    notice = null;
    const noteText = clampNoteText(entryToPlainText(note), AI_LIMITS.note);
    const turns = lastChatTurns(
      messages.map((m) => ({ role: m.role, content: m.text.length > AI_LIMITS.turn ? m.text.slice(0, AI_LIMITS.turn) : m.text })),
      MAX_TURNS,
    );
    breadcrumb(`note chat: question sent (note ${noteText.length} chars, ${turns.length} message(s))`);
    const r = await runAi({ task: "chat", note: noteText, messages: turns });
    busy = false;
    if (r.ok) {
      messages.push({ id: nextId++, role: "assistant", text: r.result.text, truncated: r.result.truncated });
      credits = { charged: r.result.creditsCharged, balance: r.result.balance };
    } else {
      notice = r.message;
    }
  }

  function retry() {
    if (canRetry) void run();
  }

  function newChat() {
    if (busy) return;
    messages = [];
    notice = null;
    credits = null;
    draft = "";
  }

  function addToPage(text: string) {
    if (!onInsert) return;
    if (onInsert(text)) {
      breadcrumb("note chat: answer added to the page");
      open = false;
    } else {
      notice = "Couldn't add it to the page. Copy the answer and paste it instead.";
    }
  }

  async function copyAnswer(text: string) {
    const ok = await copyText(text);
    pushToast({ title: ok ? "Copied" : "Couldn't copy", description: ok ? "The AI's answer is on the clipboard." : "Select the text and copy it by hand." });
  }

  function openSignIn() {
    dialogMode = "signin";
    dialogOpen = true;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(draft);
    }
  }
</script>

<Sheet bind:open side="bottom" title="Ask AI">
  <div class="chat" style="padding-bottom: {getKeyboardInset()}px">
    <p class="about">Chat about <strong>{note.title || "this note"}</strong></p>

    {#if !ai.configured}
      <p class="lead">AI isn't set up in this build.</p>
      <p class="fine">The build needs the address of the AI server: the AI_PROXY_URL secret.</p>
    {:else if !account.configured}
      <p class="lead">Online features aren't set up in this build.</p>
      {#if account.problem}<p class="fine">{configProblemMessage(account.problem)}</p>{/if}
    {:else if !account.signedIn}
      <p class="lead">Sign in to use AI.</p>
      <p class="fine">Your AI credits belong to your MidManStudio account. Everything else in MidNote keeps working without one.</p>
      <div class="actions">
        <Button variant="default" onclick={openSignIn} aria-label="Sign in to use AI">Sign in</Button>
      </div>
    {:else}
      {#if !noticeSeen}
        <section class="card" aria-label="About sending your note">
          <h3>Before you use AI</h3>
          <p class="fine">To answer, the AI is sent this whole note (all its pages) with your question. It goes to MidManStudio's AI server, is answered, and isn't stored there. Nothing changes in your note until you tap Add to page.</p>
          <div class="actions">
            <Button variant="default" onclick={ackNotice} aria-label="Understood, use AI">Got it</Button>
          </div>
        </section>
      {/if}

      <div class="log" aria-live="polite">
        {#if messages.length === 0}
          <p class="empty">Ask for a summary, the key points, a rewrite or ideas. The AI reads this whole note.</p>
          <div class="chips" role="group" aria-label="Suggestions">
            {#each SUGGESTIONS as s (s)}
              <button type="button" class="chip" disabled={!canSend} aria-label={`Chat: ${s}`} onclick={() => void ask(s)}>{s}</button>
            {/each}
          </div>
        {:else}
          {#each messages as m (m.id)}
            {#if m.role === "user"}
              <div class="bubble user">{m.text}</div>
            {:else}
              <div class="bubble assistant" aria-label="AI answer">
                <div class="answer-text">{m.text}</div>
                {#if m.truncated}<p class="cut">The AI ran out of room, so this answer is probably cut off.</p>{/if}
                <div class="row">
                  {#if onInsert}
                    <button type="button" class="mini" aria-label="Add answer to page" onclick={() => addToPage(m.text)}>Add to page</button>
                  {/if}
                  <button type="button" class="mini" aria-label="Copy answer" onclick={() => void copyAnswer(m.text)}>Copy</button>
                </div>
              </div>
            {/if}
          {/each}
          {#if busy}<div class="bubble pending" role="status">The AI is reading your note…</div>{/if}
        {/if}
      </div>

      {#if notice}
        <p class="notice error" role="alert">
          {notice}
          {#if canRetry}<button type="button" class="mini" aria-label="Try chat again" onclick={retry}>Try again</button>{/if}
        </p>
      {/if}
      {#if credits && !busy}
        <p class="line">
          {#if credits.charged !== null}Used {fmt(credits.charged)} credit{credits.charged === 1 ? "" : "s"}{#if credits.balance !== null}{" · "}{fmt(credits.balance)} left{/if}{:else}Credits for this answer are still being settled.{/if}
          {#if messages.length > 0}<button type="button" class="mini" aria-label="Start a new chat" onclick={newChat}>New chat</button>{/if}
        </p>
      {/if}

      <div class="composer">
        <input
          class="field"
          type="text"
          placeholder="Ask AI about this note…"
          aria-label="Message AI"
          autocomplete="off"
          enterkeyhint="send"
          maxlength={AI_LIMITS.turn}
          bind:value={draft}
          onkeydown={onKeydown}
        />
        <button type="button" class="send" onclick={() => void ask(draft)} disabled={!canSend || !draft.trim()} aria-label="Send message">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    {/if}
  </div>
</Sheet>

<AuthDialog bind:open={dialogOpen} bind:mode={dialogMode} />

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
  .lead {
    margin: 0;
    font-size: 15px;
    color: var(--text-hi);
  }
  .fine,
  .line {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-lo);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
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
    margin: 0;
    text-align: center;
    font-size: 13px;
    color: var(--text-faint);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
  }
  .chip {
    min-height: 36px;
    padding: 0 var(--space-3);
    font-size: 14px;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    cursor: pointer;
  }
  .chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .bubble {
    max-width: 90%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md, 12px);
    font-size: 14px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--accent);
    color: var(--bg);
  }
  .bubble.assistant {
    align-self: flex-start;
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    color: var(--text-hi);
  }
  .bubble.pending {
    align-self: flex-start;
    background: var(--surface);
    border: 1px dashed var(--hairline);
    color: var(--text-lo);
    font-size: 12px;
    font-style: italic;
  }
  .answer-text {
    white-space: pre-wrap;
  }
  .cut {
    margin: var(--space-2) 0 0;
    font-size: 12px;
    color: var(--danger);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .mini {
    min-height: 30px;
    padding: 0 var(--space-3);
    font-size: 13px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    cursor: pointer;
  }
  .notice {
    margin: 0;
    padding: var(--space-3);
    font-size: 13px;
    line-height: 1.4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    border-radius: var(--radius-md);
  }
  .notice.error {
    color: var(--danger);
    background: var(--danger-wash);
    border: 1px solid var(--danger);
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
    font-size: 16px;
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
