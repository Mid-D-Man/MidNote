<script lang="ts">
  import Card from "$lib/components/ui/Card/Card.svelte";
  import Input from "$lib/components/ui/Input/Input.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";

  let { onNoteCreated }: { onNoteCreated: (note: { title: string; content: string }) => void } = $props();

  let prompt = $state("");
  let loading = $state(false);

  // TODO: wire to src-tauri/src/ai/ once the Cloudflare AI (primary) /
  // Gemini (secondary) / Groq (tertiary) backend actually exists — that
  // work is deferred until UI + sync land, per the earlier plan. Being
  // honest about that here rather than faking a working call.
  async function generate() {
    if (!prompt.trim()) {
      pushToast({ title: "Empty prompt", description: "Describe what you'd like a note about first.", variant: "destructive" });
      return;
    }
    loading = true;
    await new Promise((r) => setTimeout(r, 400));
    loading = false;
    pushToast({
      title: "AI backend not wired up yet",
      description: "Cloudflare AI / Gemini isn't connected in MidNote yet — this is UI only for now.",
    });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !loading) {
      e.preventDefault();
      generate();
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

  <div onkeydown={onKeydown} role="presentation">
    <Input bind:value={prompt} placeholder="Describe what note you'd like to create..." />
  </div>

  <Button disabled={loading || !prompt.trim()} onclick={generate} class="generate-btn">
    {#if loading}<Spinner />{/if}
    {loading ? "Generating..." : "Generate Note"}
  </Button>
</Card>

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
</style>
