<script lang="ts">
  // Round 33/42 — Settings -> Fonts (a page since round 42; was a sheet). Two jobs:
  //   1. the DEFAULT font of the note editor (a word with its own font from
  //      the toolbar keeps it);
  //   2. importing the user's own font files (.ttf/.otf/.woff/.woff2),
  //      listing them, and deleting them.
  //
  // The file input has NO `accept` filter on purpose. Android's picker maps
  // `accept` to MIME types, and font extensions don't map reliably — a
  // partial mapping hides .ttf files entirely. Instead every file is checked
  // by its first bytes (utils/fonts.ts detectFontKind) and the message says
  // what to pick if it isn't a font.
  //
  // Delete is two taps on the same button, like Comments: a ConfirmDialog
  // stacked on a Sheet is the scrim/trailing-click race this app has hit.
  import { onDestroy } from "svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import { customFonts, fontStore, addCustomFont, removeCustomFont } from "$lib/stores/customFonts.svelte";
  import { noteFont, setNoteFont } from "$lib/stores/settings.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { customFontFamily, fontOptions, matchOption, MAX_CUSTOM_FONTS } from "$lib/utils/fonts";

  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let notice = $state<{ kind: "error" | "info"; text: string } | null>(null);
  let armedId = $state<string | null>(null);
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const options = $derived(fontOptions(customFonts.map((f) => f.name)));
  const selectedKey = $derived(matchOption(options, noteFont.value)?.key ?? "default");

  function disarm() {
    armedId = null;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  }
  onDestroy(disarm);

  function formatSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function chooseDefault(family: string | null, label: string) {
    breadcrumb(`fonts: default note font -> ${label}`);
    setNoteFont(family);
  }

  async function handleFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ""; // so picking the same file again still fires
    if (files.length === 0) return;
    importing = true;
    notice = null;
    const added: string[] = [];
    let firstError: string | null = null;
    try {
      for (const file of files) {
        const result = await addCustomFont(file);
        if (result.ok) added.push(result.font.name);
        else firstError ??= `${file.name}: ${result.message}`;
      }
    } finally {
      importing = false;
    }
    if (firstError) notice = { kind: "error", text: firstError };
    if (added.length > 0) {
      pushToast({ title: added.length === 1 ? "Font added" : `${added.length} fonts added`, description: added.join(", ") });
    }
  }

  async function onDeleteTap(id: string, name: string) {
    if (armedId !== id) {
      disarm();
      armedId = id;
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    breadcrumb(`fonts: deleting "${name}"`);
    const ok = await removeCustomFont(id);
    if (ok) pushToast({ title: "Font removed", description: name });
    else notice = { kind: "error", text: `Couldn't remove ${name}.` };
  }
</script>

  <div class="fonts">
    <section>
      <h3 class="section-label">Default note font</h3>
      <p class="section-desc">Used for the text in every note. A font picked for part of a note in the editor toolbar still wins there.</p>
      <div class="option-list" role="group" aria-label="Default note font">
        {#each options as o (o.key)}
          <button
            type="button"
            class="option"
            class:active={selectedKey === o.key}
            style={o.family ? `font-family: ${o.family}` : undefined}
            aria-label={`Default font ${o.label}`}
            aria-pressed={selectedKey === o.key}
            onclick={() => chooseDefault(o.family, o.label)}
          >
            {o.label}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <h3 class="section-label">Your fonts</h3>
      <p class="section-desc">
        Import .ttf, .otf, .woff or .woff2 files. Fonts stay on this device — notes you send or export keep their text, not the font.
      </p>

      {#if fontStore.ready && fontStore.storage === "session"}
        <p class="notice error">Storage isn't available here, so imported fonts last only until the app closes.</p>
      {/if}

      {#if customFonts.length === 0}
        <p class="empty">{fontStore.ready ? "No fonts imported yet." : "Loading…"}</p>
      {:else}
        <ul class="font-rows">
          {#each customFonts as f (f.id)}
            <li class="font-row">
              <div class="font-meta">
                <span class="font-name" style={`font-family: ${customFontFamily(f.name)}`}>{f.name}</span>
                <span class="font-size">{f.kind.toUpperCase()} · {formatSize(f.size)}</span>
              </div>
              <button
                type="button"
                class="text-action"
                class:armed={armedId === f.id}
                aria-label={armedId === f.id ? `Confirm delete ${f.name}` : `Delete font ${f.name}`}
                onclick={() => onDeleteTap(f.id, f.name)}
              >
                {armedId === f.id ? "Delete?" : "Delete"}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if notice}
        <p class="notice" class:error={notice.kind === "error"} role="status">{notice.text}</p>
      {/if}

      <input bind:this={fileInput} type="file" multiple class="file-input" onchange={handleFiles} />
      <Button
        variant="outline"
        disabled={importing || customFonts.length >= MAX_CUSTOM_FONTS}
        aria-label="Import font"
        onclick={() => {
          breadcrumb("fonts: import tapped");
          fileInput?.click();
        }}
      >
        {importing ? "Importing…" : "Import font"}
      </Button>
    </section>
  </div>

<style>
  .fonts {
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
  .section-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
  .option-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 260px;
    overflow-y: auto;
  }
  .option {
    text-align: left;
    min-height: 44px;
    padding: 0 var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-hi);
    font-size: 16px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .option:hover {
    background: var(--surface);
  }
  .option.active {
    background: var(--accent-wash);
    border-color: var(--accent);
    color: var(--accent);
  }
  .font-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .font-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 44px;
  }
  .font-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .font-name {
    font-size: 16px;
    color: var(--text-hi);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .font-size {
    font-size: 11px;
    color: var(--text-faint);
  }
  .text-action {
    flex-shrink: 0;
    min-height: 36px;
    padding: 0 var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-lo);
    font-size: 13px;
    cursor: pointer;
  }
  .text-action.armed {
    color: var(--danger, #ef4444);
    font-weight: 600;
  }
  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--text-lo);
  }
  .notice {
    margin: 0;
    font-size: 12px;
    color: var(--text-lo);
  }
  .notice.error {
    color: var(--danger, #ef4444);
  }
  .file-input {
    display: none;
  }
</style>
