<script lang="ts">
  // Round 37/42 — Settings -> Read aloud (a page since round 42; was a sheet): which voice, how fast, how high, and a
  // sample button. The voices are the ones Android's text-to-speech engine
  // reports; MidNote can't add voices to that engine, so the sheet says how to
  // get more (install voice data, or another text-to-speech app, in the
  // phone's own settings — they appear here afterwards).
  //
  // The engine may still be starting when this opens, in which case it reports
  // an empty list; "empty AND not ready" is retried a few times, "empty AND
  // ready" means no voices are installed and says so.
  import { onMount } from "svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import { ttsSettings, updateTtsSettings, loadTtsVoices, previewTtsVoice, readAloudSupported } from "$lib/stores/readAloud.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { languageChoices, pickLanguage, voicesFor, PITCH_RANGE, RATE_RANGE } from "$lib/utils/speech";
  import type { TtsVoice } from "$lib/utils/ttsBackend";

  let voices = $state<TtsVoice[]>([]);
  let status = $state<"idle" | "loading" | "ready" | "empty" | "unsupported">("idle");
  let language = $state("all");
  let attempt = 0; // invalidates an in-flight load when the page closes or reloads

  const languages = $derived(languageChoices(voices));
  const listed = $derived(voicesFor(voices, language));

  async function loadVoices() {
    const mine = ++attempt;
    if (!readAloudSupported()) {
      status = "unsupported";
      return;
    }
    status = "loading";
    for (let i = 0; i < 8; i++) {
      try {
        const r = await loadTtsVoices();
        if (mine !== attempt) return;
        if (r.voices.length > 0) {
          voices = r.voices;
          language = pickLanguage(r.voices, ttsSettings.voiceId, typeof navigator === "undefined" ? undefined : navigator.language);
          status = "ready";
          breadcrumb(`read aloud: ${r.voices.length} voice(s) loaded`);
          return;
        }
        if (r.ready) break; // the engine is up and has none
      } catch (err) {
        breadcrumb(`read aloud: voice list failed (${err instanceof Error ? err.message : String(err)})`);
        if (mine !== attempt) return;
      }
      await new Promise((res) => setTimeout(res, 700));
      if (mine !== attempt) return;
    }
    voices = [];
    status = "empty";
  }

  onMount(() => {
    void loadVoices();
    return () => {
      attempt++;
    };
  });

  const fmt = (n: number) => `${n.toFixed(1)}×`;
</script>

  <div class="ra">
    {#if status === "unsupported"}
      <p class="note">Read aloud uses your phone's text-to-speech voices, so it works in the Android app.</p>
    {:else}
      <section>
        <h3 class="section-label">Voice</h3>
        {#if status === "loading"}
          <p class="note">Loading voices…</p>
        {:else if status === "empty"}
          <p class="note error">No voices found. Install voice data in your phone's Text-to-speech settings, then reopen this.</p>
          <Button variant="outline" aria-label="Refresh voices" onclick={() => void loadVoices()}>Refresh</Button>
        {:else if status === "ready"}
          {#if languages.length > 1}
            <select class="lang" aria-label="Voice language" bind:value={language}>
              <option value="all">All languages</option>
              {#each languages as l (l.code)}
                <option value={l.code}>{l.label}</option>
              {/each}
            </select>
          {/if}
          <div class="voice-list" role="group" aria-label="Voices">
            <button
              type="button"
              class="voice"
              class:active={ttsSettings.voiceId === null}
              aria-pressed={ttsSettings.voiceId === null}
              aria-label="Voice Default"
              onclick={() => updateTtsSettings({ voiceId: null })}
            >
              Default voice
            </button>
            {#each listed as v (v.id)}
              <button
                type="button"
                class="voice"
                class:active={ttsSettings.voiceId === v.id}
                aria-pressed={ttsSettings.voiceId === v.id}
                aria-label={`Voice ${v.name}`}
                onclick={() => updateTtsSettings({ voiceId: v.id })}
              >
                {v.name}
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section>
        <h3 class="section-label">Speed <span class="val">{fmt(ttsSettings.rate)}</span></h3>
        <input
          type="range"
          aria-label="Speech speed"
          min={RATE_RANGE.min}
          max={RATE_RANGE.max}
          step="0.1"
          value={ttsSettings.rate}
          oninput={(e) => updateTtsSettings({ rate: Number((e.currentTarget as HTMLInputElement).value) })}
        />
        <h3 class="section-label">Pitch <span class="val">{fmt(ttsSettings.pitch)}</span></h3>
        <input
          type="range"
          aria-label="Speech pitch"
          min={PITCH_RANGE.min}
          max={PITCH_RANGE.max}
          step="0.1"
          value={ttsSettings.pitch}
          oninput={(e) => updateTtsSettings({ pitch: Number((e.currentTarget as HTMLInputElement).value) })}
        />
        <Button variant="outline" aria-label="Play sample" onclick={() => void previewTtsVoice()}>Play sample</Button>
      </section>

      <p class="note">
        Voices come from your phone's text-to-speech engine. To add more, install voice data or another text-to-speech app in your phone's
        Text-to-speech settings and choose it there — new voices appear here. Reading stops when you leave the page.
      </p>
    {/if}
  </div>

<style>
  .ra {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section-label {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-lo);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .val {
    margin-left: var(--space-2);
    color: var(--accent);
    text-transform: none;
    letter-spacing: 0;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
  .note.error {
    color: var(--danger);
  }
  .lang {
    height: 40px;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 14px;
  }
  .voice-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 260px;
    overflow-y: auto;
  }
  .voice {
    text-align: left;
    min-height: 44px;
    padding: 0 var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 14px;
    cursor: pointer;
  }
  .voice:hover {
    background: var(--surface);
  }
  .voice.active {
    background: var(--accent-wash);
    border-color: var(--accent);
    color: var(--accent);
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
