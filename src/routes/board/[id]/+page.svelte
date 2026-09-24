<!--
  Board editor route. Structurally parallel to note/[id] and todo/[id]:
  same load()/persist() shape, same locked-placeholder gate, same
  session-unlock + onNavigate relock pair. The one real difference is
  that the "body" here is a canvas rather than a scrollable document,
  so this page never scrolls — the canvas owns its whole area and pans
  internally.
-->
<script lang="ts">
  import { page } from "$app/stores";
  import { goto, onNavigate } from "$app/navigation";
  import { onMount, untrack } from "svelte";
  import BoardCanvas from "$lib/components/boards/BoardCanvas/BoardCanvas.svelte";
  import BoardHeader from "$lib/components/boards/BoardHeader/BoardHeader.svelte";
  import Spinner from "$lib/components/ui/Spinner/Spinner.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { boardTags } from "$lib/stores/tags.svelte";
  import { createBoard, getEntry } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import { unlockForSession, relockSilently } from "$lib/utils/lockFlow";
  import type { Board, BoardEdge, BoardNode, BoardViewport, LockKeyMode } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let board = $state<Board>(createBoard());
  let loadError = $state<string | null>(null);
  // Bumped by load() specifically, not on every board mutation — see
  // BoardCanvas.svelte's identical syncToken comment for why this
  // exists at all (the canvas otherwise seeds itself from `board`
  // before load() ever replaces the blank default with the real saved
  // entry, which is the exact "resets on reopen" bug this fixes).
  let syncToken = $state(0);
  // Typed as just the surface actually used rather than the component
  // instance type — bind:this exposes BoardCanvas's `export function`
  // and this is the whole of what this route calls on it.
  let canvas = $state<{ addNode: (kind: "text" | "image") => void } | null>(null);

  onMount(() => {
    breadcrumb(`board page mounted, id=${id}`);
    load();
  });

  // Same session-unlock lifecycle as the note/todo editors — see
  // note/[id]/+page.svelte's identical pair for the full reasoning.
  let relockCreds = $state<{ entry: Board; password: string; mode: LockKeyMode } | null>(null);

  onNavigate(async () => {
    const creds = relockCreds;
    if (!creds) return;
    relockCreds = null;
    if (!getEntry(creds.entry.id)) return;
    await relockSilently(creds.entry, creds.password, creds.mode);
  });

  $effect(() => {
    breadcrumb(`board page effect: id=${id}`);
    load();
  });

  function load() {
    try {
      loadError = null;
      if (!id || id === "new") {
        board = createBoard();
        syncToken = untrack(() => syncToken) + 1;
        breadcrumb("board: created new");
        return;
      }
      const existing = getEntry(id);
      if (existing && existing.type === "board") {
        board = existing;
        syncToken = untrack(() => syncToken) + 1;
        breadcrumb(`board: loaded ${id}, ${existing.nodes.length} nodes, ${existing.edges.length} edges`);
      } else {
        breadcrumb(`board: ${id} not found or wrong type, redirecting home`);
        goto("/");
      }
    } catch (err) {
      console.error("board page: load() threw:", err);
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  // Mirrors the todo route's persist(): don't write an untouched blank
  // board to storage just because someone tapped "+ New Board" and
  // backed straight out, or the list would fill with empty boards.
  function persist() {
    if (!board.title.trim() && board.nodes.length === 0) return;
    saveEntry(board);
  }

  function handleCanvasChange(next: { nodes: BoardNode[]; edges: BoardEdge[]; viewport: BoardViewport | null }) {
    board.nodes = next.nodes;
    board.edges = next.edges;
    board.viewport = next.viewport;
    persist();
  }

  function setTags(tags: string[]) {
    board.tags = tags;
    persist();
  }

  let unlocking = $state(false);
  async function handleUnlock() {
    unlocking = true;
    try {
      const result = await unlockForSession(board);
      if (result) relockCreds = { entry: board, password: result.password, mode: result.mode };
    } finally {
      unlocking = false;
    }
  }
</script>

<svelte:head>
  <title>{board.title || "Untitled board"} — MidNote</title>
</svelte:head>

<main class="board-page">
  {#if loadError}
    <div class="error-state">
      <p><strong>Something went wrong opening this board.</strong></p>
      <p class="error-detail">{loadError}</p>
      <button onclick={() => goto("/")}>Back to MidNote</button>
    </div>
  {:else}
    <BoardHeader {board} availableTags={boardTags} onTagsChange={setTags} onSave={persist} onPersist={persist} onBack={() => goto("/")} />
    <!-- BoardHeader's Theme sheet sets headerTheme/icon on `board`, same
         as Note/Todo do for their own header+icon. Body theme dropped
         entirely for boards (CLAUDEcode: "boards don't need body theme")
         — a canvas has no body surface for a wash to apply to the way a
         note's writing area or a todo's steps list does, so there was
         never a real use for it here. headerTheme renders immediately
         (BoardHeader's own header background); icon persists correctly
         but isn't shown on the list card yet (see round 17's board-card
         comment in +page.svelte) — smaller follow-up once wanted. -->

    {#if board.encrypted}
      <div class="locked-state">
        <div class="lock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
          </svg>
        </div>
        <p><strong>This board is locked.</strong></p>
        <p class="locked-detail">Unlock it to view or edit its contents.</p>
        <button class="unlock-btn" onclick={handleUnlock} disabled={unlocking}>
          {#if unlocking}
            <Spinner class="unlock-spinner" />
          {/if}
          {unlocking ? "Unlocking…" : "Unlock"}
        </button>
      </div>
    {:else}
      <div class="canvas-area">
        <BoardCanvas
          bind:this={canvas}
          nodes={board.nodes}
          edges={board.edges}
          viewport={board.viewport}
          {syncToken}
          onchange={handleCanvasChange}
        />
      </div>

      <!-- Bottom-anchored rather than in the header: on a phone the
           header is the hardest place on the screen to reach one-handed,
           and these are the two most-used controls on this page. -->
      <div class="add-bar">
        <button onclick={() => canvas?.addNode("text")}>+ Text</button>
        <button onclick={() => canvas?.addNode("image")}>+ Image</button>
      </div>
    {/if}
  {/if}
</main>

<style>
  .board-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 100vw;
    overflow: hidden;
    background: var(--bg);
  }
  .canvas-area {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .add-bar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3);
    /* BUGFIX: this bar sat flush against the true bottom of the screen,
       with no allowance for Android's own nav bar (3-button nav) or
       gesture bar — both draw on top of app content unless the app
       explicitly leaves room. Same established pattern already used
       for SelectionActionBar.svelte's identical bottom bar and
       FormattingToolbar.svelte's bottom-anchored toolbar. */
    padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--hairline);
    flex-shrink: 0;
  }
  .add-bar button {
    flex: 1;
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    color: var(--text-hi);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .add-bar button:hover {
    border-color: var(--accent-dim);
  }
  .locked-state,
  .error-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-6);
    text-align: center;
    color: var(--text-hi);
  }
  .lock-icon {
    color: var(--text-faint);
    margin-bottom: var(--space-2);
  }
  .locked-detail,
  .error-detail {
    color: var(--text-lo);
    font-size: 14px;
  }
  .unlock-btn {
    margin-top: var(--space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-6);
    background: var(--accent);
    border: none;
    border-radius: var(--radius-md);
    color: #fff;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }
  .unlock-btn:disabled {
    opacity: 0.7;
  }
  .error-state button {
    margin-top: var(--space-4);
    padding: var(--space-3) var(--space-6);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    color: var(--text-hi);
    cursor: pointer;
  }
</style>
