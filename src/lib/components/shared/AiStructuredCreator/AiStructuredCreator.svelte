<script lang="ts">
  // "Create with AI" on the Todos and Boards tabs of the landing page (the Notes tab has AiNoteCreator). Describe a todo
  // list or a board, the AI writes it, and you see it FIRST: nothing is created until you tap Create. Only the landing page
  // has this; the todo and board editors have no AI inside them.
  //
  // The server asks the model for a plain line format (workers/midnote-ai/src/prompts.ts) and utils/aiStructured.ts reads it
  // tolerantly, with hard limits. A board's positions are never the AI's: the app lays the nodes out (utils/aiBoardLayout.ts).
  // Only what you type here is sent, to MidManStudio's AI server, to be answered (it isn't kept there; a backup provider
  // may answer). State is written from handlers only (docs/svelte5-effect-safety.md).
  import { goto } from "$app/navigation";
  import Card from "$lib/components/ui/Card/Card.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account } from "$lib/stores/account.svelte";
  import { ai, initAi, runAi } from "$lib/stores/ai.svelte";
  import { configProblemMessage } from "$lib/online/authMessages";
  import { parseAiTodo, parseAiBoard, fallbackTitle, type ParsedTodo, type ParsedBoard } from "$lib/utils/aiStructured";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let {
    kind,
    onTodo,
    onBoard,
  }: {
    kind: "todo" | "board";
    /** Files the todo and returns its id (so the toast can open it). */
    onTodo?: (todo: ParsedTodo & { title: string }) => string | void;
    /** Files the board (laying it out) and returns its id. */
    onBoard?: (board: ParsedBoard & { title: string }) => string | void;
  } = $props();

  type Draft = {
    todo: (ParsedTodo & { title: string }) | null;
    board: (ParsedBoard & { title: string }) | null;
    truncated: boolean;
    charged: number | null;
    balance: number | null;
  };

  let prompt = $state("");
  let loading = $state(false);
  let notice = $state<string | null>(null);
  let draft = $state<Draft | null>(null);
  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");
  let lastPrompt = "";

  initAi();

  const noun = $derived(kind === "todo" ? "todo" : "board");
  const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const ready = $derived(ai.configured && account.configured && account.signedIn);

  const labelOf = (d: Draft, key: string) => d.board?.nodes.find((n) => n.key === key)?.label ?? key;

  async function generate(text: string) {
    const p = text.trim();
    if (!p) {
      pushToast({ title: "Empty prompt", description: `Describe what you'd like the ${noun} to be about first.`, variant: "destructive" });
      return;
    }
    if (!ready || loading) return;
    loading = true;
    notice = null;
    draft = null;
    lastPrompt = p;
    breadcrumb(`ai ${noun} creator: requested (${p.length} chars)`);
    const r = await runAi({ task: "create", prompt: p, shape: kind });
    loading = false;
    if (!r.ok) {
      notice = r.message;
      return;
    }
    const todo = kind === "todo" ? parseAiTodo(r.result.text) : null;
    const board = kind === "board" ? parseAiBoard(r.result.text) : null;
    if (!todo && !board) {
      notice = `The AI's answer couldn't be turned into a ${noun}. Try again, or describe it a little differently.`;
      breadcrumb(`ai ${noun} creator: answer not usable`);
      return;
    }
    draft = {
      todo: todo ? { ...todo, title: todo.title || fallbackTitle(p) } : null,
      board: board ? { ...board, title: board.title || fallbackTitle(p) } : null,
      truncated: r.result.truncated,
      charged: r.result.creditsCharged,
      balance: r.result.balance,
    };
  }

  function create() {
    if (!draft) return;
    const d = draft;
    const id = (d.todo ? onTodo?.(d.todo) : d.board ? onBoard?.(d.board) : undefined) ?? undefined;
    breadcrumb(`ai ${noun} creator: ${noun} created`);
    const title = d.todo?.title ?? d.board?.title ?? "";
    draft = null;
    prompt = "";
    pushToast({
      title: `${noun === "todo" ? "Todo" : "Board"} created`,
      description: title,
      durationMs: 8000,
      action: id ? { label: "Open", run: () => void goto(`/${noun}/${id}`) } : undefined,
    });
  }

  function discard() {
    draft = null;
    notice = null;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !loading) {
      e.preventDefault();
      void generate(prompt);
    }
  }
</script>

<Card class="ai-structured">
  <div class="heading">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="2">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
    <h3>Create with AI</h3>
  </div>

  {#if !ai.configured}
    <p class="fine">AI isn't set up in this build.</p>
  {:else if !account.configured}
    <p class="fine">Online features aren't set up in this build.{#if account.problem} {configProblemMessage(account.problem)}{/if}</p>
  {:else if !account.signedIn}
    <p class="fine">Sign in to have AI write a {noun} for you. Your AI credits belong to your MidManStudio account.</p>
    <Button onclick={() => ((dialogMode = "signin"), (dialogOpen = true))} class="generate-btn" aria-label="Sign in to use AI">Sign in</Button>
  {:else}
    <div onkeydown={onKeydown} role="presentation">
      <Input bind:value={prompt} placeholder={kind === "todo" ? "Describe the todo list you'd like..." : "Describe the board you'd like..."} aria-label={`Describe the ${noun} you want`} />
    </div>

    <Button disabled={loading || !prompt.trim()} onclick={() => void generate(prompt)} class="generate-btn" aria-label={`Generate ${noun} with AI`}>
      {#if loading}<Spinner />{/if}
      {loading ? "Generating..." : `Generate ${noun === "todo" ? "Todo" : "Board"}`}
    </Button>
    <p class="fine">Your description is sent to MidManStudio's AI server, which doesn't keep it, and is answered by Cloudflare or, if Cloudflare is out of free capacity, by a backup provider (Groq or Mistral) under its own privacy terms. You see the {noun} before anything is created.</p>

    {#if notice}
      <p class="notice error" role="alert">{notice}</p>
    {/if}

    {#if draft}
      <section class="preview" aria-label={`AI ${noun} preview`}>
        <p class="line">The AI's {noun}. Nothing has been created yet.</p>
        {#if draft.todo}
          <h4>{draft.todo.title}</h4>
          <div class="body">
            {#each draft.todo.categories as cat (cat)}
              <p class="group">{cat}</p>
              <ul>
                {#each draft.todo.steps.filter((s) => s.category === cat) as step, i (cat + i)}
                  <li>{step.title}{#if step.content}<span class="detail"> — {step.content}</span>{/if}</li>
                {/each}
              </ul>
            {/each}
          </div>
          <p class="line">{draft.todo.steps.length} step{draft.todo.steps.length === 1 ? "" : "s"} in {draft.todo.categories.length} categor{draft.todo.categories.length === 1 ? "y" : "ies"}.</p>
        {:else if draft.board}
          <h4>{draft.board.title}</h4>
          <div class="body">
            <p class="group">Nodes</p>
            <ul>
              {#each draft.board.nodes as n (n.key)}
                <li>{n.label}{#if n.body}<span class="detail"> — {n.body}</span>{/if}</li>
              {/each}
            </ul>
            {#if draft.board.links.length > 0}
              <p class="group">Links</p>
              <ul>
                {#each draft.board.links as l (l.from + ">" + l.to)}
                  <li>{labelOf(draft, l.from)} → {labelOf(draft, l.to)}</li>
                {/each}
              </ul>
            {/if}
          </div>
          <p class="line">{draft.board.nodes.length} node{draft.board.nodes.length === 1 ? "" : "s"}, {draft.board.links.length} link{draft.board.links.length === 1 ? "" : "s"}. The app places them for you; you can move them after.</p>
        {/if}
        {#if (draft.todo?.dropped ?? draft.board?.dropped ?? 0) > 0}
          <p class="line">Some of the AI's lines were left out because there were too many or they didn't fit.</p>
        {/if}
        {#if draft.truncated}
          <p class="notice error" role="alert">The AI ran out of room, so the end of this {noun} is probably missing.</p>
        {/if}
        <p class="line">
          {#if draft.charged !== null}Used {fmt(draft.charged)} credit{draft.charged === 1 ? "" : "s"}{#if draft.balance !== null}{" · "}{fmt(draft.balance)} left{/if}{:else}Credits for this answer are still being settled.{/if}
        </p>
        <div class="actions">
          <Button onclick={create} aria-label={`Create AI ${noun}`}>Create {noun}</Button>
          <Button variant="outline" onclick={() => void generate(lastPrompt)} disabled={loading} aria-label="Generate again">Try again</Button>
          <Button variant="ghost" onclick={discard} aria-label={`Discard AI ${noun}`}>Discard</Button>
        </div>
      </section>
    {/if}
  {/if}
</Card>

<AuthDialog bind:open={dialogOpen} bind:mode={dialogMode} />

<style>
  :global(.ai-structured) {
    padding: var(--space-5);
    border-style: dashed;
    border-width: 2px;
    border-color: var(--accent-dim);
    background: var(--accent-wash);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .heading h3 {
    font-family: var(--font-display);
    font-size: 14px;
    color: var(--text-hi);
    margin: 0;
  }
  :global(.ai-structured .generate-btn) {
    width: 100%;
  }
  .fine,
  .line {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-lo);
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
  }
  .preview h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-hi);
    overflow-wrap: anywhere;
  }
  .body {
    overflow-wrap: anywhere;
    max-height: 40vh;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-hi);
  }
  .group {
    margin: var(--space-2) 0 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-lo);
  }
  ul {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-5);
  }
  .detail {
    color: var(--text-lo);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .notice {
    margin: 0;
    padding: var(--space-3);
    font-size: 13px;
    line-height: 1.4;
    border-radius: var(--radius-md);
  }
  .notice.error {
    color: var(--danger);
    background: var(--danger-wash);
    border: 1px solid var(--danger);
  }
</style>
