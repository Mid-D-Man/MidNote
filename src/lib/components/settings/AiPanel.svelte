<script lang="ts">
  // Settings -> AI (round D2).
  //
  //   not set up        this build has no AI server address (the AI_PROXY_URL secret)
  //   signed out        AI needs the MidManStudio account: opens the sign-in dialog
  //   signed in         the credit numbers (credits left, left today, is the shared free capacity open)
  //                     and a "Try AI" box: write a note from a sentence, or edit a text
  //
  // The answer is only SHOWN here, with Copy. Nothing is saved and no note is changed: the AI never
  // changes anything without the person pressing a button for it (the note editor's flow, which
  // previews first, comes in the next round). The credit numbers come from the AI server, which
  // owns the budget; this screen only displays them.
  import { untrack } from "svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account } from "$lib/stores/account.svelte";
  import { ai, initAi, refreshAiStatus, runAi } from "$lib/stores/ai.svelte";
  import { AI_LIMITS, type AiRequest } from "$lib/online/aiClient";
  import { formatWait } from "$lib/online/aiMessages";
  import { configProblemMessage } from "$lib/online/authMessages";
  import { copyText } from "$lib/utils/copyText";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");

  let mode = $state<"create" | "transform">("create");
  let prompt = $state("");
  let instruction = $state("");
  let text = $state("");
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let answer = $state<{ text: string; charged: number | null; balance: number | null } | null>(null);

  const canAsk = $derived(!busy && (mode === "create" ? prompt.trim() !== "" : instruction.trim() !== "" && text.trim() !== ""));

  // load the numbers once when a signed-in person is looking at this page (plain let: not tracked)
  let autoLoaded = false;
  initAi();
  $effect(() => {
    const ready = account.signedIn && ai.configured;
    if (!ready) {
      autoLoaded = false;
      return;
    }
    if (!autoLoaded) {
      autoLoaded = true;
      untrack(() => {
        void refreshAiStatus();
      });
    }
  });

  const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  function topupLabel(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function openSignIn() {
    breadcrumb("ai: sign-in opened from the AI screen");
    dialogMode = "signin";
    dialogOpen = true;
  }

  async function ask() {
    if (!canAsk) return;
    busy = true;
    notice = null;
    answer = null;
    const req: AiRequest = mode === "create" ? { task: "create", prompt } : { task: "transform", instruction, text };
    const r = await runAi(req);
    busy = false;
    if (r.ok) {
      answer = { text: r.result.text, charged: r.result.creditsCharged, balance: r.result.balance };
    } else {
      notice = r.message;
    }
  }

  async function copyAnswer() {
    if (!answer) return;
    const ok = await copyText(answer.text);
    pushToast({ title: ok ? "Copied" : "Couldn't copy", description: ok ? "The AI's answer is on the clipboard." : "Select the text and copy it by hand." });
  }

  function clearAnswer() {
    answer = null;
    notice = null;
  }
</script>

<div class="ai">
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
    <section class="card" aria-label="AI credits">
      <h2>Your AI credits</h2>
      {#if ai.status}
        {#if ai.status.hasAccount}
          <p class="big"><span>{fmt(ai.status.balance)}</span> credits left</p>
          <p class="line">Left today: {fmt(ai.status.dailyLeft)} of {fmt(ai.status.dailyCap)}</p>
          {#if topupLabel(ai.status.nextTopupAt)}<p class="line">Next top-up: {topupLabel(ai.status.nextTopupAt)}</p>{/if}
        {:else}
          <p class="big"><span>{fmt(ai.status.balance)}</span> credits to start</p>
          <p class="line">They're added the first time you use AI.</p>
        {/if}
        {#if !ai.status.enabled}
          <p class="state off">AI is switched off right now.</p>
        {:else if !ai.status.poolOpen}
          <p class="state off">AI is resting: today's free capacity is used up. It's back in {formatWait(ai.status.resetsIn)}.</p>
        {:else}
          <p class="state on">AI is available.</p>
        {/if}
      {:else if ai.loading}
        <p class="line">Loading your credits…</p>
      {:else if ai.statusError}
        <p class="notice error" role="alert">{ai.statusError}</p>
      {/if}
      <div class="actions">
        <Button variant="outline" onclick={() => void refreshAiStatus()} disabled={ai.loading} aria-label="Refresh AI credits">{ai.loading ? "Refreshing…" : "Refresh"}</Button>
      </div>
    </section>

    <section class="card" aria-label="Try AI">
      <h2>Try AI</h2>
      <div class="modes" role="group" aria-label="What to try">
        <button type="button" class="mode" class:on={mode === "create"} aria-pressed={mode === "create"} aria-label="Write a note" onclick={() => (mode = "create")}>Write a note</button>
        <button type="button" class="mode" class:on={mode === "transform"} aria-pressed={mode === "transform"} aria-label="Edit text" onclick={() => (mode = "transform")}>Edit text</button>
      </div>
      {#if mode === "create"}
        <textarea
          class="field"
          rows="3"
          maxlength={AI_LIMITS.prompt}
          aria-label="What should the AI write?"
          placeholder="e.g. A packing list for a weekend away"
          value={prompt}
          oninput={(e) => (prompt = e.currentTarget.value)}
        ></textarea>
      {:else}
        <input
          class="field"
          type="text"
          maxlength={AI_LIMITS.instruction}
          aria-label="What should the AI do with the text?"
          placeholder="e.g. Make it shorter"
          value={instruction}
          oninput={(e) => (instruction = e.currentTarget.value)}
        />
        <textarea
          class="field"
          rows="5"
          maxlength={AI_LIMITS.text}
          aria-label="Text to change"
          placeholder="Paste or type the text here"
          value={text}
          oninput={(e) => (text = e.currentTarget.value)}
        ></textarea>
      {/if}
      <div class="actions">
        <Button variant="default" onclick={ask} disabled={!canAsk} aria-label="Ask AI">{busy ? "Thinking…" : "Ask AI"}</Button>
      </div>
      {#if notice}
        <p class="notice error" role="alert">{notice}</p>
      {/if}
      {#if answer}
        <section class="answer" aria-label="AI answer">
          <p class="line">The AI's answer. Nothing is saved or changed.</p>
          <div class="answer-text">{answer.text}</div>
          <p class="line">
            {#if answer.charged !== null}Used {fmt(answer.charged)} credit{answer.charged === 1 ? "" : "s"}{#if answer.balance !== null}{" · "}{fmt(answer.balance)} left{/if}{:else}Credits for this answer are still being settled.{/if}
          </p>
          <div class="actions">
            <Button variant="default" onclick={copyAnswer} aria-label="Copy AI answer">Copy</Button>
            <Button variant="ghost" onclick={clearAnswer} aria-label="Clear AI answer">Clear</Button>
          </div>
        </section>
      {/if}
    </section>
    <p class="fine">Only the text you type here is sent, to MidManStudio's AI server, to be answered. It isn't stored there.</p>
  {/if}
</div>

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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .big {
    margin: 0;
    font-size: 14px;
    color: var(--text-lo);
  }
  .big span {
    font-size: 28px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .line {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-lo);
  }
  .state {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .state.on {
    color: var(--accent);
  }
  .state.off {
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
  .field {
    font-family: var(--font-sans);
    font-size: 16px;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
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
    max-height: 40vh;
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
