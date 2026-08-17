<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, untrack } from "svelte";
  import TodoHeader from "$lib/components/todos/TodoHeader/TodoHeader.svelte";
  import TodoCategoryTabs from "$lib/components/todos/TodoCategoryTabs/TodoCategoryTabs.svelte";
  import TodoStepsSection from "$lib/components/todos/TodoStepsSection/TodoStepsSection.svelte";
  import TodoAnnotationsSidebar from "$lib/components/todos/TodoAnnotationsSidebar/TodoAnnotationsSidebar.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { todoTags, sync as syncTags } from "$lib/stores/tags.svelte";
  import { createTodo, getEntry, generateId } from "$lib/storage";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import type { Todo } from "$lib/types/entry";

  const id = $derived($page.params.id);

  let todo = $state<Todo>(createTodo());
  let currentCategory = $state("Steps");
  let notesOpen = $state(false);
  let loadError = $state<string | null>(null);

  onMount(() => {
    breadcrumb(`todo page mounted, id=${id}`);
    syncTags();
    load();
  });

  $effect(() => {
    breadcrumb(`todo page effect: id=${id}`);
    load();
  });

  function load() {
    try {
      loadError = null;
      if (!id || id === "new") {
        todo = createTodo();
        // untrack is load-bearing here, not cosmetic — this is the exact
        // bug that caused the hang. load() runs inside the $effect below,
        // which also WRITES `todo` (the reassignment above). Reading
        // todo.categories right after, untracked, makes `todo` a
        // dependency of that same effect — an effect that both reads and
        // writes what it depends on re-triggers itself forever in
        // Svelte 5. Reproduced this exact shape against the real Svelte
        // runtime: unfixed throws effect_update_depth_exceeded within
        // milliseconds, fixed settles after one run.
        currentCategory = untrack(() => todo.categories[0]) ?? "Steps";
        breadcrumb("todo: created new");
        return;
      }
      const existing = getEntry(id);
      if (existing && existing.type === "todo") {
        todo = existing;
        currentCategory = untrack(() => todo.categories[0]) ?? "Steps";
        breadcrumb(
          `todo: loaded ${id}, ${untrack(() => todo.steps.length)} steps, ${untrack(() => todo.categories.length)} categories`
        );
      } else {
        breadcrumb(`todo: ${id} not found or wrong type, redirecting home`);
        goto("/");
      }
    } catch (err) {
      console.error("todo page: load() threw:", err);
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function persist() {
    if (!todo.title.trim() && todo.steps.length === 0) return;
    saveEntry(todo);
  }

  function setTags(tags: string[]) {
    todo.tags = tags;
    persist();
  }

  function addCategory(name: string) {
    if (!todo.categories.includes(name)) {
      todo.categories.push(name);
      currentCategory = name;
      persist();
    }
  }

  function removeCategory(name: string) {
    todo.categories = todo.categories.filter((c) => c !== name);
    todo.steps = todo.steps.filter((s) => s.category !== name);
    todo.annotations = todo.annotations.filter((a) => a.category !== name);
    persist();
  }

  function addStep() {
    todo.steps.push({ id: generateId(), category: currentCategory, title: "", content: "" });
    persist();
  }

  function updateStep(stepId: string, title: string, content: string) {
    const step = todo.steps.find((s) => s.id === stepId);
    if (!step) return;
    step.title = title;
    step.content = content;
    persist();
  }

  function deleteStep(stepId: string) {
    todo.steps = todo.steps.filter((s) => s.id !== stepId);
    persist();
  }

  function addAnnotation(category: string) {
    todo.annotations.push({ id: generateId(), category, title: "", content: "" });
    persist();
  }

  function updateAnnotation(annotationId: string, title: string, content: string) {
    const a = todo.annotations.find((x) => x.id === annotationId);
    if (!a) return;
    a.title = title;
    a.content = content;
    persist();
  }

  function deleteAnnotation(annotationId: string) {
    todo.annotations = todo.annotations.filter((a) => a.id !== annotationId);
    persist();
  }

  const stepsForCategory = $derived(todo.steps.filter((s) => s.category === currentCategory));
</script>

<svelte:head>
  <title>{todo.title || "Untitled"} — MidNote</title>
</svelte:head>

<main class="todo-page">
  {#if loadError}
    <div class="error-state">
      <p><strong>Something went wrong opening this todo.</strong></p>
      <p class="error-detail">{loadError}</p>
      <button onclick={() => goto("/")}>Back to MidNote</button>
    </div>
  {:else}
  <TodoHeader
    {todo}
    availableTags={todoTags}
    onTagsChange={setTags}
    onSave={persist}
    onBack={() => goto("/")}
    onShowNotes={() => (notesOpen = true)}
  />

  <div class="title-row">
    <input
      type="text"
      bind:value={todo.title}
      onblur={persist}
      placeholder="Todo title..."
      class="todo-title"
    />
  </div>

  <TodoCategoryTabs
    categories={todo.categories}
    {currentCategory}
    onCategoryChange={(c) => (currentCategory = c)}
    onAddCategory={addCategory}
    onRemoveCategory={removeCategory}
  />

  <div class="body">
    <TodoStepsSection
      steps={stepsForCategory}
      category={currentCategory}
      onAddStep={addStep}
      onUpdateStep={updateStep}
      onDeleteStep={deleteStep}
    />
  </div>

  <TodoAnnotationsSidebar
    bind:open={notesOpen}
    annotations={todo.annotations}
    {currentCategory}
    onAddAnnotation={addAnnotation}
    onUpdateAnnotation={updateAnnotation}
    onDeleteAnnotation={deleteAnnotation}
  />
  {/if}
</main>

<style>
  .todo-page {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 100vw;
    overflow-x: hidden;
    background: var(--bg);
  }
  .title-row {
    flex-shrink: 0;
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--hairline);
    background: var(--surface);
  }
  .todo-title {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    color: var(--text-hi);
    background: transparent;
    border: none;
    padding: var(--space-3) 0;
  }
  .todo-title::placeholder {
    color: var(--text-faint);
  }
  .todo-title:focus {
    outline: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .error-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-5);
    text-align: center;
  }
  .error-state p {
    color: var(--text-hi);
    margin: 0;
  }
  .error-detail {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-lo);
  }
  .error-state button {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
  }
</style>
