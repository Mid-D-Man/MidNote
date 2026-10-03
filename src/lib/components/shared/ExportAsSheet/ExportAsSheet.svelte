<script lang="ts">
  // Round 30 — "Export as…" from the Actions sheet of the note, todo and
  // board editors: pick Plain text, Markdown, Word document or PDF for this
  // one entry (Markdown added in round 34).
  //
  // The files are built by utils/export (no dependency — see docx.ts /
  // pdf.ts headers) and handed to the same downloadFiles() the existing
  // Export button and the list's multi-select use, so saving behaves
  // identically (Downloads on desktop, the save dialog on Android).
  //
  // The header gates this on the lock (a locked entry's content is cleared
  // on the visible record, so there is nothing honest to export) before
  // opening it; this component never decrypts anything.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { downloadFiles } from "$lib/utils/selectionActions";
  import { buildEntryDocument, DOC_FORMATS, type DocFormat } from "$lib/utils/export";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { Entry } from "$lib/types/entry";

  let { open = $bindable(false), entry }: { open?: boolean; entry: Entry } = $props();

  let busy = $state<DocFormat | null>(null);

  async function run(format: DocFormat) {
    if (busy) return;
    busy = format;
    breadcrumb(`export as: ${format} for ${entry.type} ${entry.id}`);
    try {
      // Let the spinner paint before the (synchronous) document build —
      // a big note's PDF can take a moment on a phone.
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      const file = buildEntryDocument(entry, format);
      const built = Math.round(performance.now() - t0);
      const saved = await downloadFiles([file]);
      breadcrumb(`export as: ${file.name} built in ${built}ms (${Math.round(file.blob.size / 1024)}KB), saved=${saved}`);
      // Save dialog cancelled: say nothing and stay put, so another format
      // can be picked — a false "Exported" toast would be worse than none.
      if (saved === 0) return;
      pushToast({ title: "Exported", description: file.name });
      open = false;
    } catch (err) {
      console.error("export as failed:", err);
      breadcrumb(`export as: ${format} FAILED: ${err instanceof Error ? err.message : String(err)}`);
      pushToast({ title: "Export failed", description: "Something went wrong building that file.", variant: "destructive" });
    } finally {
      busy = null;
    }
  }
</script>

<Sheet bind:open side="bottom" title="Export as">
  <div class="formats">
    {#each DOC_FORMATS as f (f.id)}
      <button
        type="button"
        class="row"
        onclick={() => run(f.id)}
        disabled={busy !== null}
        aria-label={`Export as ${f.label}`}
      >
        <span class="badge">{f.id === "txt" ? "TXT" : f.id === "md" ? "MD" : f.id === "docx" ? "DOC" : "PDF"}</span>
        <span class="text">
          <span class="label">{f.label}</span>
          <span class="detail">{f.detail}</span>
        </span>
        {#if busy === f.id}
          <span class="spin" aria-hidden="true"></span>
        {/if}
      </button>
    {/each}
    <p class="note">Comments are private and are never included in an export.</p>
  </div>
</Sheet>

<style>
  .formats {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3);
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md, 12px);
    color: var(--text-hi);
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .row:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .badge {
    flex-shrink: 0;
    min-width: 42px;
    padding: 6px 0;
    text-align: center;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--bg);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .label {
    font-size: 15px;
    font-weight: 600;
  }
  .detail {
    font-size: 12px;
    color: var(--text-lo);
  }
  .spin {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: 2px solid var(--hairline);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .note {
    margin: var(--space-1) 0 0;
    font-size: 11px;
    color: var(--text-faint);
    text-align: center;
  }
</style>
