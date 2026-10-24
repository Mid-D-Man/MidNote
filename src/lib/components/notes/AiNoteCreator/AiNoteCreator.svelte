<script lang="ts">
  // Round G — "Create with AI" on the notes list. Describe a note, the AI writes it, and you see it FIRST: nothing is
  // created until you tap Create note. It becomes a normal note (tagged "AI Generated") with real bullets and bold.
  // It replaces the earlier honest stub. Only what you type here is sent, to MidManStudio's AI server, to be
  // answered (it isn't kept there; a backup provider may answer). State is written from handlers only (docs/svelte5-effect-safety.md).
  import { goto } from "$app/navigation";
  import Card from "$lib/components/ui/Card/Card.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import AuthDialog, { type AuthMode } from "$lib/components/layout/AuthDialog/AuthDialog.svelte";
  import { account } from "$lib/stores/account.svelte";
  import { ai, initAi, runAi } from "$lib/stores/ai.svelte";
  import { AI_LIMITS } from "$lib/online/aiClient";
  import { configProblemMessage } from "$lib/online/authMessages";
  import { aiTextToHtml, splitTitledNote } from "$lib/utils/aiNoteHtml";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let {
    onNoteCreated,
  }: {
    /** Files the note and returns its id (so the toast can open it). `html` is what the note stores; `content` is the plain text. */
    onNoteCreated: (note: { title: string; content: string; html: string }) => string | void;
  } = $props();

  type Draft = { title: string; body: string; prompt: string; truncated: boolean; charged: number | null; balance: number | null };

  let prompt = $state("");
  let loading = $state(false);
  let notice = $state<string | null>(null);
  let draft = $state<Draft | null>(null);
  let dialogOpen = $state(false);
  let dialogMode = $state<AuthMode>("signin");
  // what the last request asked for, for "Generate again"
  let lastPrompt = "";

  initAi();

  const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const ready = $derived(ai.configured && account.configured && account.signedIn);

  async function generate(text: string) {
    const p = text.trim();
    if (!p) {
      pushToast({ title: "Empty prompt", description: "Describe what you'd like a note about first.", variant: "destructive" });
      return;
    }
    if (!ready || loading) return;
    loading = true;
    notice = null;
    draft = null;
    lastPrompt = p;
    breadcrumb(`ai note creator: requested (${p.length} chars)`);
    const r = await runAi({ task: "create", prompt: p, titled: true });
    loading = false;
    if (!r.ok) {
      notice = r.message;
      return;
    }
    const parts = splitTitledNote(r.result.text, p);
    draft = { title: parts.title, body: parts.body, prompt: p, truncated: r.result.truncated, charged: r.result.creditsCharged, balance: r.result.balance };
  }

  function create() {
    if (!draft) return;
    const d = draft;
    const id = onNoteCreated({ title: d.title, content: d.body, html: aiTextToHtml(d.body) });
    breadcrumb("ai note creator: note created");
    draft = null;
    prompt = "";
    pushToast({
      title: "Note created",
      description: d.title,
      durationMs: 8000,
      action: id ? { label: "Open", run: () => void goto(`/note/${id}`) } : undefined,
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

<Card class="ai-creator">
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
    <p class="fine">Sign in to have AI write a note for you. Your AI credits belong to your MidManStudio account.</p>
    <Button onclick={() => ((dialogMode = "signin"), (dialogOpen = true))} class="generate-btn" aria-label="Sign in to use AI">Sign in</Button>
  {:else}
    <div onkeydown={onKeydown} role="presentation">
      <Input bind:value={prompt} placeholder="Describe what note you'd like to create..." aria-label="Describe the note you want" />
    </div>

    <Button disabled={loading || !prompt.trim()} onclick={() => void generate(prompt)} class="generate-btn" aria-label="Generate note with AI">
      {#if loading}<Spinner />{/if}
      {loading ? "Generating..." : "Generate Note"}
    </Button>
    <p class="fine">Your description is sent to MidManStudio's AI server, which doesn't keep it, and is answered by Cloudflare or, if Cloudflare is out of free capacity, by a backup provider (Groq or Mistral) under its own privacy terms. You see the note before anything is created.</p>

    {#if notice}
      <p class="notice error" role="alert">{notice}</p>
    {/if}

    {#if draft}
      <section class="preview" aria-label="AI note preview">
        <p class="line">The AI's note. Nothing has been created yet.</p>
        <h4>{draft.title}</h4>
        <div class="body">{draft.body}</div>
        {#if draft.truncated}
          <p class="notice error" role="alert">The AI ran out of room, so the end of this note is probably missing.</p>
        {/if}
        <p class="line">
          {#if draft.charged !== null}Used {fmt(draft.charged)} credit{draft.charged === 1 ? "" : "s"}{#if draft.balance !== null}{" · "}{fmt(draft.balance)} left{/if}{:else}Credits for this answer are still being settled.{/if}
        </p>
        <div class="actions">
          <Button onclick={create} aria-label="Create AI note">Create note</Button>
          <Button variant="outline" onclick={() => void generate(lastPrompt)} disabled={loading} aria-label="Generate again">Try again</Button>
          <Button variant="ghost" onclick={discard} aria-label="Discard AI note">Discard</Button>
        </div>
      </section>
    {/if}
  {/if}
</Card>

<AuthDialog bind:open={dialogOpen} bind:mode={dialogMode} />

<style>
  :global(.ai-creator) {
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
  :global(.generate-btn) {
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
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 40vh;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-hi);
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
