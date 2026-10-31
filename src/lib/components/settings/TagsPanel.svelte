<script lang="ts">
  // Round H — Settings -> Tags. The BUILT-IN (system) tags are listed first: always available, never removable. Then the
  // SHARED tags (added here once, they appear in the Notes, Todos and Boards lists), then the tags the person made in one
  // list (Notes / Todos / Boards), each with how many items use it and a Remove button.
  // Removing a tag only takes it off the list (the same as the × on the notes list); items that already have it keep it.
  // The built-in tags are merged in by stores/tags.svelte.ts, so the lists below already contain them: they are
  // filtered out of "Your tags" here by name. State is read-only derived; the one write is a click handler.
  import { entries } from "$lib/stores/entries.svelte";
  import { noteTags, todoTags, boardTags, unregisterTag, registerSharedTag, unregisterSharedTag, isSharedTag } from "$lib/stores/tags.svelte";
  import { cleanTagName, MAX_TAG_LENGTH } from "$lib/utils/tagNames";
  import { SYSTEM_TAGS, isSystemTag } from "$lib/utils/systemTags";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { TagScope } from "$lib/storage";

  const SCOPES: { scope: TagScope; label: string; type: string }[] = [
    { scope: "notes", label: "Notes", type: "regular" },
    { scope: "todos", label: "Todos", type: "todo" },
    { scope: "boards", label: "Boards", type: "board" },
  ];
  const LABEL: Record<TagScope, string> = { notes: "Notes", todos: "Todos", boards: "Boards" };

  const listFor = (scope: TagScope) => (scope === "notes" ? noteTags : scope === "todos" ? todoTags : boardTags);
  /** How many (not deleted) items carry `name` themselves; "type" limits it to one kind of item. */
  const uses = (name: string, type?: string) => entries.filter((e) => !e.deletedAt && (type === undefined || e.type === type) && (e.tags ?? []).includes(name)).length;
  const usage = (n: number) => (n === 0 ? "Not used yet" : n === 1 ? "On 1 item" : `On ${n} items`);

  // Shared tags: the ones in all three lists. Derived from the lists, so adding or removing one updates this at once.
  const sharedTags = $derived(noteTags.filter((t) => isSharedTag(t)));
  let newShared = $state("");

  function addShared() {
    const name = cleanTagName(newShared);
    if (!name) {
      pushToast({ title: "Type a tag name", description: `Up to ${MAX_TAG_LENGTH} characters.` });
      return;
    }
    const result = registerSharedTag(name);
    breadcrumb(`settings: shared tag ${result}`);
    if (result === "built-in") {
      pushToast({ title: "That one is built in", description: `"${name}" is already in your tag lists.` });
    } else if (result === "exists") {
      pushToast({ title: "Already a shared tag", description: `"${name}" is already in Notes, Todos and Boards.` });
    } else {
      pushToast({ title: "Shared tag added", description: `"${name}" is now in Notes, Todos and Boards.` });
      newShared = "";
    }
  }

  function removeShared(tag: string) {
    breadcrumb("settings: shared tag removed from all lists");
    unregisterSharedTag(tag);
    pushToast({ title: "Tag removed from all lists", description: `Items that already have "${tag}" keep it.` });
  }

  function remove(scope: TagScope, tag: string) {
    if (isSystemTag(tag, scope)) return;
    breadcrumb(`settings: tag removed from the ${scope} list`);
    unregisterTag(scope, tag);
    pushToast({ title: "Tag removed from the list", description: `Items that already have "${tag}" keep it.` });
  }
</script>

<div class="tags">
  <p class="lead">Tags group your notes, todos and boards. A tag on a folder also applies to everything inside it.</p>

  <section aria-label="System tags">
    <h3>System tags</h3>
    <p class="fine">Built in. They are always in your tag lists, and can't be removed.</p>
    <ul class="rows">
      {#each SYSTEM_TAGS as t (t.name)}
        <li class="row" aria-label={`System tag ${t.name}`}>
          <div class="top">
            <span class="chip">{t.name}</span>
            <span class="badge">Built in</span>
          </div>
          <p class="what">{t.what}</p>
          <p class="meta">{t.scopes.map((s) => LABEL[s]).join(", ")} · {usage(uses(t.name))}</p>
        </li>
      {/each}
    </ul>
  </section>

  <section aria-label="Shared tags">
    <h3>Shared tags</h3>
    <p class="fine">Add a tag here once and it shows up in your Notes, Todos and Boards lists.</p>
    <div class="add-row">
      <input
        type="text"
        class="add-input"
        placeholder="New shared tag"
        aria-label="New shared tag"
        maxlength={MAX_TAG_LENGTH}
        bind:value={newShared}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addShared();
          }
        }}
      />
      <button type="button" class="add-btn" aria-label="Add shared tag" disabled={newShared.trim().length === 0} onclick={addShared}>Add</button>
    </div>
    {#if sharedTags.length === 0}
      <p class="empty">No shared tags yet.</p>
    {:else}
      <ul class="rows">
        {#each sharedTags as tag (tag)}
          <li class="row mine" aria-label={`Shared tag ${tag}`}>
            <div class="top">
              <span class="chip">{tag}</span>
              <span class="meta">Notes, Todos, Boards · {usage(uses(tag))}</span>
            </div>
            <button type="button" class="remove" aria-label={`Remove shared tag ${tag}`} onclick={() => removeShared(tag)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-label="Your tags">
    <h3>Your tags</h3>
    <p class="fine">Tags you made in one list. Removing a tag only takes it off the list. Items that already have it keep it.</p>
    {#each SCOPES as s (s.scope)}
      {@const own = listFor(s.scope).filter((t) => !isSystemTag(t, s.scope) && !isSharedTag(t))}
      <h4>{s.label}</h4>
      {#if own.length === 0}
        <p class="empty">No tags yet. Add one from the {s.label} tab.</p>
      {:else}
        <ul class="rows">
          {#each own as tag (tag)}
            <li class="row mine" aria-label={`${s.label} tag ${tag}`}>
              <div class="top">
                <span class="chip">{tag}</span>
                <span class="meta">{usage(uses(tag, s.type))}</span>
              </div>
              <button type="button" class="remove" aria-label={`Remove tag ${tag} from ${s.label}`} onclick={() => remove(s.scope, tag)}>Remove</button>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </section>
</div>

<style>
  .tags {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
  }
  h4 {
    margin: var(--space-2) 0 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-lo);
  }
  .lead,
  .fine,
  .what,
  .meta,
  .empty {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-lo);
  }
  .meta,
  .empty {
    color: var(--text-faint);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    min-width: 0;
  }
  .row.mine {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
  }
  .chip {
    font-size: 12px;
    padding: 2px var(--space-3);
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .badge {
    font-size: 11px;
    padding: 1px var(--space-2);
    border-radius: 999px;
    border: 1px solid var(--hairline);
    color: var(--text-lo);
  }
  .add-row {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
  }
  .add-input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 var(--space-3);
    font-size: 14px;
    font-family: inherit;
    color: var(--text-hi);
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .add-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .add-btn {
    flex-shrink: 0;
    min-height: 44px;
    padding: 0 var(--space-4);
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    background: var(--accent);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .add-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .remove {
    flex-shrink: 0;
    min-height: 32px;
    padding: 0 var(--space-3);
    font-size: 13px;
    color: var(--danger);
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    cursor: pointer;
  }
</style>
