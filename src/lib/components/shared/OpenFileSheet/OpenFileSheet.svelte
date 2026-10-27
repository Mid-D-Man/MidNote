<script lang="ts">
  // Round K — what you see after choosing MidNote in your phone's "Open with" list for a file.
  //
  // Mounted once in the root layout; shown whenever the open-with store is reading a file or holds one. Nothing is
  // created until a button here is tapped, and the file is only ever READ (its text is escaped, never run).
  //   text / Word file  -> a preview and "Create note"
  //   MidNote backup    -> "Open in Backup & restore" (which shows its own preview before anything is restored)
  //   anything else     -> why it can't be opened
  import { goto } from "$app/navigation";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import { openWith, dismissOpenFile, createNoteFromOpenFile, sendOpenFileToBackup } from "$lib/stores/openWith.svelte";
  import { textStats } from "$lib/utils/wordCount";

  const nf = new Intl.NumberFormat();
  const file = $derived(openWith.file);
  const isText = $derived(file !== null && (file.kind === "text" || file.kind === "docx"));
  const words = $derived(file !== null && isText ? textStats(file.text).words : 0);
  const preview = $derived(file !== null && isText ? file.text.slice(0, 500) : "");

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function makeNote() {
    const id = createNoteFromOpenFile();
    if (id) void goto(`/note/${id}`);
  }

  function toBackup() {
    if (sendOpenFileToBackup()) void goto("/settings/backup");
  }
</script>

<Sheet bind:open={() => openWith.busy || openWith.file !== null, (v) => { if (!v) dismissOpenFile(); }} side="bottom" title="Open file">
  <div class="of">
    {#if openWith.busy && !file}
      <div class="reading" role="status">
        <Spinner />
        <span>Reading the file…</span>
      </div>
    {:else if file}
      <div class="head">
        <span class="name" aria-label="File name">{file.name ?? "Unnamed file"}</span>
        <span class="size">{formatSize(file.size)}</span>
      </div>

      {#if isText}
        <p class="line" aria-label="File summary">
          {file.kind === "docx" ? "Word document" : "Text file"} · {nf.format(words)} words · {nf.format(file.chars)} characters
        </p>
        <pre class="preview" aria-label="Preview">{preview}{file.text.length > preview.length ? "…" : ""}</pre>
        {#if file.cut}
          <p class="warn" role="note">
            This file is very long. Only the first {nf.format(file.text.length)} characters will go into the note.
          </p>
        {/if}
        <div class="buttons">
          <Button aria-label="Create note" onclick={makeNote}>Create note</Button>
          <Button variant="outline" aria-label="Cancel" onclick={dismissOpenFile}>Cancel</Button>
        </div>
      {:else if file.kind === "backup"}
        {#if file.part === "key"}
          <p class="line">This is the key file of a password-protected MidNote backup. Open the backup file (.mdix.enc) with MidNote too, or pick both together in Settings → Backup &amp; restore.</p>
          <div class="buttons">
            <Button aria-label="Close" onclick={dismissOpenFile}>Close</Button>
          </div>
        {:else}
          <p class="line">
            {file.part === "encrypted"
              ? "This is a password-protected MidNote backup. Backup & restore will ask for its key file and password."
              : "This is a MidNote backup. Backup & restore shows what is in it before anything is restored."}
          </p>
          <div class="buttons">
            <Button aria-label="Open in Backup and restore" onclick={toBackup}>Open in Backup &amp; restore</Button>
            <Button variant="outline" aria-label="Cancel" onclick={dismissOpenFile}>Cancel</Button>
          </div>
        {/if}
      {:else}
        <p class="line" aria-label="Why it can't be opened">{file.message}</p>
        <div class="buttons">
          <Button aria-label="Close" onclick={dismissOpenFile}>Close</Button>
        </div>
      {/if}

      <p class="fine">
        {isText
          ? "MidNote only reads the text of a file. Nothing in it is run, and nothing is saved unless you tap Create note."
          : "MidNote only reads files. Nothing in them is ever run."}
      </p>
    {/if}
  </div>
</Sheet>

<style>
  .of {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
    min-width: 0;
  }
  .reading {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) 0;
    color: var(--text-lo);
    font-size: 14px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
    color: var(--text-hi);
  }
  .size {
    flex: none;
    font-size: 12px;
    color: var(--text-lo);
  }
  .line {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-hi);
    overflow-wrap: anywhere;
  }
  .preview {
    margin: 0;
    max-height: 30vh;
    overflow: auto;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md, 12px);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-hi);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .warn {
    margin: 0;
    font-size: 13px;
    color: var(--text-hi);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .fine {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-lo);
  }
</style>
