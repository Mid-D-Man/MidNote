<script lang="ts">
  // Round 30 — comments on a note, todo or board, opened from the Actions
  // sheet of each editor header (the Notion "comment under the page title"
  // reference, minus collaboration: MidNote has no accounts, so a comment
  // is simply your own timestamped remark on the whole entry).
  //
  // Persistence follows the same rule as every other Actions-sheet change
  // (Pin, theme, icon): mutate THIS editor's own `entry` — the getEntry()
  // copy, not the entries store's — then saveEntry() it. Mutating the
  // store's copy instead would be overwritten by the editor's next
  // autosave with a stale list.
  //
  // The logic that can be tested without a browser (what counts as a
  // comment, how times read) lives in utils/comments.ts.
  //
  // Delete is two taps on the same button (it turns into "Delete?" for a
  // few seconds) instead of a ConfirmDialog: a dialog opened on top of a
  // Sheet is the exact scrim/trailing-click race this codebase has been
  // bitten by before, and a comment is too small to justify the risk.
  import { onDestroy } from "svelte";
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { generateId } from "$lib/storage";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { makeComment, editComment, formatCommentTime, sortByTime, MAX_COMMENT_LENGTH } from "$lib/utils/comments";
  import type { Entry } from "$lib/types/entry";

  let { open = $bindable(false), entry }: { open?: boolean; entry: Entry } = $props();

  let draft = $state("");
  // Round 34: editing reuses the composer. `editingId` is the comment being
  // changed (its text is loaded into `draft`); the send button then saves
  // instead of posting, and Cancel puts things back.
  let editingId = $state<string | null>(null);
  let armedId = $state<string | null>(null);
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let logEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLTextAreaElement | null>(null);

  const ordered = $derived(sortByTime(entry.comments));

  // Newest comment in view whenever the sheet opens or one is added.
  $effect(() => {
    if (!open) return;
    ordered.length; // re-run when a comment is added/removed
    queueMicrotask(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  });

  // A stale "Delete?" must not survive closing the sheet.
  $effect(() => {
    if (!open) {
      disarm();
      cancelEdit();
    }
  });

  function disarm() {
    armedId = null;
    if (armTimer) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  }
  onDestroy(disarm);

  function startEdit(id: string) {
    const c = entry.comments.find((x) => x.id === id);
    if (!c) return;
    disarm();
    editingId = id;
    draft = c.text;
    queueMicrotask(() => {
      grow();
      inputEl?.focus();
    });
  }

  function cancelEdit() {
    editingId = null;
    draft = "";
    if (inputEl) inputEl.style.height = "auto";
  }

  function post() {
    if (editingId) {
      const next = editComment(entry.comments, editingId, draft);
      if (!next) return;
      breadcrumb(`comments: edited on ${entry.type} ${entry.id}`);
      entry.comments = next;
      saveEntry(entry);
      cancelEdit();
      return;
    }
    const c = makeComment(draft, generateId());
    if (!c) return;
    breadcrumb(`comments: added (${c.text.length} chars) to ${entry.type} ${entry.id}`);
    entry.comments = [...entry.comments, c];
    saveEntry(entry);
    draft = "";
    if (inputEl) inputEl.style.height = "auto";
  }

  function onDeleteTap(id: string) {
    if (armedId !== id) {
      disarm();
      armedId = id;
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    breadcrumb(`comments: deleted from ${entry.type} ${entry.id}`);
    entry.comments = entry.comments.filter((c) => c.id !== id);
    saveEntry(entry);
    pushToast({ title: "Comment deleted" });
  }

  function grow() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
  }

  function onKeydown(e: KeyboardEvent) {
    // Plain Enter is a new line (phone keyboards); Ctrl/Cmd+Enter posts.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      post();
    }
  }
</script>

<Sheet bind:open side="bottom" title="Comments">
  <div class="comments">
    <div class="log" bind:this={logEl}>
      {#if ordered.length === 0}
        <p class="empty">No comments yet. Add a private remark about this {entry.type === "regular" ? "note" : entry.type}.</p>
      {:else}
        {#each ordered as c (c.id)}
          <div class="item">
            <div class="avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
              </svg>
            </div>
            <div class="body">
              <div class="meta">
                <span class="when">{formatCommentTime(c.createdAt)}</span>
                <button
                  type="button"
                  class="del"
                  onclick={() => startEdit(c.id)}
                  aria-label="Edit comment"
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="del"
                  class:armed={armedId === c.id}
                  onclick={() => onDeleteTap(c.id)}
                  aria-label={armedId === c.id ? "Confirm delete comment" : "Delete comment"}
                >
                  {armedId === c.id ? "Delete?" : "✕"}
                </button>
              </div>
              <p class="text">{c.text}</p>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if editingId}
      <div class="editing-bar">
        <span>Editing comment</span>
        <button type="button" class="del" onclick={cancelEdit} aria-label="Cancel editing">Cancel</button>
      </div>
    {/if}
    <div class="composer">
      <textarea
        bind:this={inputEl}
        bind:value={draft}
        class="field"
        rows="1"
        maxlength={MAX_COMMENT_LENGTH}
        placeholder={editingId ? "Edit your comment…" : "Add a comment…"}
        aria-label={editingId ? "Edit comment text" : "Add a comment"}
        oninput={grow}
        onkeydown={onKeydown}
      ></textarea>
      <button type="button" class="send" onclick={post} disabled={!draft.trim()} aria-label={editingId ? "Save comment" : "Post comment"}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
    </div>
  </div>
</Sheet>

<style>
  .comments {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 200px;
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: 42vh;
    overflow-y: auto;
  }
  .empty {
    margin: var(--space-4) 0;
    text-align: center;
    font-size: 13px;
    color: var(--text-faint);
  }
  .item {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .avatar {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--text-lo);
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .when {
    margin-right: auto; /* Edit and delete sit together at the right */
    font-size: 11px;
    color: var(--text-faint);
  }
  .del {
    min-width: 32px;
    height: 26px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-faint);
    font-family: var(--font-sans);
    font-size: 12px;
    cursor: pointer;
  }
  .editing-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-lo);
  }
  .del.armed {
    background: var(--danger);
    color: #fff;
    font-weight: 600;
  }
  .text {
    margin: 2px 0 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--text-hi);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .field {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    min-height: 40px;
    max-height: 120px;
    padding: 10px var(--space-3);
    resize: none;
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.3;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 20px;
  }
  .field:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .field::placeholder {
    color: var(--text-faint);
  }
  .send {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
