<script lang="ts">
  // Round F — the note editor's AI sheet: select text, tap the sparkle, say what to do. The AI is shown the
  // selection AND the rest of the page (read-only, so it understands the context); you see its answer here first.
  //
  //   Edit  the answer is meant to replace the selection  -> Replace selection / Insert below / Copy
  //   Ask   an answer ABOUT the selection (explain, ...)   -> Insert below / Copy
  //   Continue (a quick action) writes new text that follows the selection -> Insert below / Copy
  //
  // NOTHING changes in the note until a button is tapped, and Replace is one undo step. An answer that used the
  // model's whole output allowance is probably cut off: Replace is then switched off (it would delete text).
  // The first time, a notice explains that the note text goes to the AI server (and is not stored there).
  // utils/aiSelection.ts holds the rules; this file is the screen. State is written from handlers only
  // (docs/svelte5-effect-safety.md): there is no $effect here.
  import { tick } from "svelte";
  import type { Editor } from "@tiptap/core";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account } from "$lib/stores/account.svelte";
  import { ai, initAi, runAi } from "$lib/stores/ai.svelte";
  import { AI_LIMITS, type AiEditMode } from "$lib/online/aiClient";
  import { ASK_CHIPS, EDIT_CHIPS, LONG_SELECTION_CHARS, planInsertBelow, planReplace, type AiSelection } from "$lib/utils/aiSelection";
  import { configProblemMessage } from "$lib/online/authMessages";
  import { copyText } from "$lib/utils/copyText";
  import { getKeyboardInset } from "$lib/utils/keyboardInset.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let {
    open = $bindable(false),
    selection,
    editor,
  }: {
    open?: boolean;
    /** Taken when the sparkle was tapped; everything here works from it. */
    selection: AiSelection;
    editor: Editor;
  } = $props();

  const NOTICE_KEY = "midnote:ai-notice";
  function readNoticeSeen(): boolean {
    try {
      return localStorage.getItem(NOTICE_KEY) === "1";
    } catch {
      return false;
    }
  }

  type Result = { text: string; mode: AiEditMode; charged: number | null; balance: number | null; truncated: boolean };

  let mode = $state<"edit" | "ask">("edit");
  let instruction = $state("");
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let result = $state<Result | null>(null);
  let noticeSeen = $state(readNoticeSeen());
  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");
  let resultEl = $state<HTMLElement | null>(null);
  // the last request, for "Try again" (not reactive: nothing renders from it)
  let last: { instruction: string; mode: AiEditMode } | null = null;

  initAi();

  const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const tooLong = $derived(selection.text.length > AI_LIMITS.text);
  const longEdit = $derived(mode === "edit" && selection.text.length > LONG_SELECTION_CHARS && !tooLong);
  const ready = $derived(ai.configured && account.configured && account.signedIn);
  const canSend = $derived(ready && noticeSeen && !busy && !tooLong);
  const chips = $derived(mode === "edit" ? EDIT_CHIPS : ASK_CHIPS);
  const preview = $derived(selection.text.length > 240 ? `${selection.text.slice(0, 240)}…` : selection.text);

  function ackNotice() {
    try {
      localStorage.setItem(NOTICE_KEY, "1");
    } catch {
      /* the notice just shows again next time */
    }
    noticeSeen = true;
  }

  function setMode(m: "edit" | "ask") {
    if (busy) return;
    mode = m;
    notice = null;
  }

  async function run(instr: string, m: AiEditMode) {
    const text = instr.trim();
    if (!canSend || !text) return;
    busy = true;
    notice = null;
    result = null;
    last = { instruction: text, mode: m };
    breadcrumb(`ai: ${m} requested (${selection.text.length} chars selected, note text ${selection.before.length}+${selection.after.length})`);
    const r = await runAi({ task: "transform", instruction: text, text: selection.text, mode: m, before: selection.before, after: selection.after });
    busy = false;
    if (r.ok) {
      result = { text: r.result.text, mode: m, charged: r.result.creditsCharged, balance: r.result.balance, truncated: r.result.truncated };
      await tick();
      resultEl?.scrollIntoView?.({ block: "nearest" });
    } else {
      notice = r.message;
    }
  }

  function sendCustom() {
    void run(instruction, mode === "ask" ? "ask" : "edit");
  }

  function retry() {
    if (last) void run(last.instruction, last.mode);
  }

  const STALE = "The note changed since you selected this text, so the answer can't be put back in the same place. Insert it below or copy it instead.";
  const EMPTY = "The AI's answer was empty, so there is nothing to insert.";

  function replace() {
    if (!result || result.mode !== "edit" || result.truncated || editor.isDestroyed) return;
    const plan = planReplace(editor.state, selection, result.text);
    if (!plan.ok) {
      notice = plan.reason === "stale" ? STALE : EMPTY;
      return;
    }
    editor.view.dispatch(plan.tr);
    const done = editor.state.doc;
    breadcrumb("ai: selection replaced");
    pushToast({
      title: "Replaced",
      description: "Undo brings the old text back.",
      durationMs: 6000,
      // only while nothing else has changed the note since: otherwise Undo would undo something else
      action: {
        label: "Undo",
        run: () => {
          if (!editor.isDestroyed && editor.state.doc.eq(done)) editor.commands.undo();
        },
      },
    });
    open = false;
  }

  function insertBelow() {
    if (!result || editor.isDestroyed) return;
    const plan = planInsertBelow(editor.state, selection, result.text);
    if (!plan.ok) {
      notice = plan.reason === "stale" ? STALE : EMPTY;
      return;
    }
    editor.view.dispatch(plan.tr);
    const done = editor.state.doc;
    breadcrumb("ai: answer inserted below the selection");
    pushToast({
      title: "Inserted below",
      description: "Undo takes it out again.",
      durationMs: 6000,
      action: {
        label: "Undo",
        run: () => {
          if (!editor.isDestroyed && editor.state.doc.eq(done)) editor.commands.undo();
        },
      },
    });
    open = false;
  }

  async function copyResult() {
    if (!result) return;
    const ok = await copyText(result.text);
    pushToast({ title: ok ? "Copied" : "Couldn't copy", description: ok ? "The AI's answer is on the clipboard." : "Select the text and copy it by hand." });
  }

  function openSignIn() {
    breadcrumb("ai: sign-in opened from the note AI sheet");
    dialogMode = "signin";
    dialogOpen = true;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCustom();
    }
  }
</script>

<Sheet bind:open side="bottom" title="Ask AI">
  <div class="ai" style="padding-bottom: {getKeyboardInset()}px">
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
          <p class="fine">To understand what you selected, the AI is sent the selection and the rest of this page of the note. It goes to MidManStudio's AI server, is answered, and isn't stored there. Nothing changes in your note until you tap Replace or Insert.</p>
          <div class="actions">
            <Button variant="default" onclick={ackNotice} aria-label="Understood, use AI">Got it</Button>
          </div>
        </section>
      {/if}

      {#if result}
        <section class="answer" aria-label="AI result" bind:this={resultEl}>
          <p class="line">{result.mode === "edit" ? "The AI's rewrite. Your note hasn't changed yet." : result.mode === "continue" ? "The AI's continuation. Your note hasn't changed yet." : "The AI's answer. Your note hasn't changed yet."}</p>
          <div class="answer-text">{result.text}</div>
          {#if result.truncated}
            <p class="notice error" role="alert">The AI ran out of room, so this answer is probably cut off.{result.mode === "edit" ? " Replace is off so no text is lost. Try a shorter selection." : ""}</p>
          {/if}
          <p class="line">
            {#if result.charged !== null}Used {fmt(result.charged)} credit{result.charged === 1 ? "" : "s"}{#if result.balance !== null}{" · "}{fmt(result.balance)} left{/if}{:else}Credits for this answer are still being settled.{/if}
          </p>
          <div class="actions">
            {#if result.mode === "edit"}
              <Button variant="default" onclick={replace} disabled={result.truncated} aria-label="Replace selection with AI result">Replace selection</Button>
              <Button variant="outline" onclick={insertBelow} aria-label="Insert AI result below">Insert below</Button>
            {:else}
              <Button variant="default" onclick={insertBelow} aria-label="Insert AI result below">Insert below</Button>
            {/if}
            <Button variant="outline" onclick={copyResult} aria-label="Copy AI result">Copy</Button>
            <Button variant="ghost" onclick={retry} disabled={busy} aria-label="Try AI again">Try again</Button>
          </div>
        </section>
      {/if}

      <section class="selected" aria-label="Selected text">
        <p class="line">Selected text · {fmt(selection.text.length)} character{selection.text.length === 1 ? "" : "s"}</p>
        <p class="preview">{preview}</p>
      </section>

      {#if tooLong}
        <p class="notice error" role="alert">That selection is too long for AI (the limit is {fmt(AI_LIMITS.text)} characters). Select less text.</p>
      {:else if longEdit}
        <p class="fine">This is a long selection. The AI can write back about 3,000 characters; if its answer is cut off, Replace stays off.</p>
      {/if}

      <div class="modes" role="group" aria-label="What the AI should do">
        <button type="button" class="mode" class:on={mode === "edit"} aria-pressed={mode === "edit"} aria-label="AI mode: edit" onclick={() => setMode("edit")}>Edit</button>
        <button type="button" class="mode" class:on={mode === "ask"} aria-pressed={mode === "ask"} aria-label="AI mode: ask" onclick={() => setMode("ask")}>Ask</button>
      </div>

      <div class="send-row">
        <input
          class="field"
          type="text"
          enterkeyhint="send"
          maxlength={AI_LIMITS.instruction}
          aria-label={mode === "edit" ? "What should the AI do with it?" : "What do you want to ask about it?"}
          placeholder={mode === "edit" ? "e.g. Make it sound friendlier" : "e.g. What does this mean?"}
          value={instruction}
          oninput={(e) => (instruction = e.currentTarget.value)}
          onkeydown={onKey}
        />
        <Button variant="default" onclick={sendCustom} disabled={!canSend || instruction.trim() === ""} aria-label="Send to AI">{busy ? "Thinking…" : "Send"}</Button>
      </div>

      <div class="chips" role="group" aria-label="Quick actions">
        {#each chips as chip (chip.id)}
          <button type="button" class="chip" disabled={!canSend} aria-label={`AI: ${chip.label}`} onclick={() => void run(chip.instruction, chip.mode)}>{chip.label}</button>
        {/each}
      </div>

      {#if busy}
        <p class="line" role="status">The AI is working on it…</p>
      {/if}
      {#if notice}
        <p class="notice error" role="alert">{notice}</p>
      {/if}
    {/if}
  </div>
</Sheet>

<AuthDialog bind:open={dialogOpen} bind:mode={dialogMode} />

<style>
  .ai {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .lead {
    margin: 0;
    font-size: 15px;
    color: var(--text-hi);
  }
  .fine {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-lo);
  }
  .line {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-lo);
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
  .selected {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .preview {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 96px;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-hi);
  }
  .modes {
    display: flex;
    gap: var(--space-2);
  }
  .mode {
    flex: 1;
    min-height: 40px;
    font-size: 14px;
    color: var(--text-lo);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .mode.on {
    color: var(--text-hi);
    border-color: var(--accent);
  }
  .send-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .field {
    flex: 1;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: 16px;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    box-sizing: border-box;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
  }
  .answer-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 32vh;
    overflow-y: auto;
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-hi);
  }
  .notice {
    margin: 0;
    padding: var(--space-3);
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .notice.error {
    color: var(--danger);
    background: var(--danger-wash);
    border-color: var(--danger);
  }
</style>
