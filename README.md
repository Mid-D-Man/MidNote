# MidNote

AI-powered notes & todos — Tauri + SvelteKit, DixScript-backed local storage.
Ships mobile first, then desktop, then web.

Rebuilt from [SimpleNotesAndRecipies](https://github.com/Mid-D-Man/SimpleNotesAndRecipies)
(Next.js/shadcn/Groq) — same UI/UX intent, new stack. Baseline generated for
real via `npm create tauri-app@latest MidNote -- -m npm -t svelte-ts
--identifier com.midmanstudio.midnote -y`, then layered with the structure
below.

## Layout

```
src/lib/
  components/
    notes/     — NoteCard, NoteEditorHeader, NoteTitle, NoteContent,
                  FormattingToolbar, AiNoteCreator
    todos/     — TodoHeader, TodoCategoryTabs,
                  TodoStepsSection/ (+ TodoStepCard),
                  TodoAnnotationsSidebar/ (+ TodoAnnotationCard)
    shared/    — AiSuggestions, TagSelector (used by both notes and todos)
    layout/    — AppHeader, LoadingScreen, AuthDialog
    ui/        — hand-rolled primitives (button, dialog, tabs, etc.),
                  replacing shadcn/Radix — no UI framework, matches mdix-cybs
  stores/      — notes.ts, todos.ts, tags.ts, theme.ts
  dixscript/   — client.ts, thin wrapper around the Tauri commands below
  tokens.css   — design tokens: dark royal-blue ink, cool ivory light mode

src-tauri/src/
  data/        — the only place touching the `dixscript` crate directly;
                  entries.rs, index.rs, tags.rs
  commands/    — #[tauri::command] handlers, thin adapters over data/
  ai/, sync/   — scaffolded, empty — deferred until UI + sync architecture
                  are settled (Cloudflare AI primary, Gemini secondary,
                  Groq tertiary fallback, once it's time)

mdix_files/schema/  — validated reference .mdix files: one note, one todo,
                       tags.mdix, notes_index.mdix, todos_index.mdix.
                       Real user data lives in the OS app-data dir at
                       runtime, not in the repo — these are the shape
                       reference, each already round-tripped through the
                       real DixScript parser.

.mdix/project_structure/project_structure.mdix — regenerates this directory
  shape (not the file contents) against a fresh baseline.
```

## Renamed from the original app

The original data model's `type: "todo"` was implemented under
`app/todo/[id]/page.tsx` but the components were all named `Recipe*`
(`RecipeHeader`, `RecipeStepsSection`, ...) — split naming between the data
layer and the UI layer. Standardized on **todo** everywhere here
(`EntryType.TODO`, `TodoHeader`, `TodoStepsSection`, ...).

The per-todo side notes (`notes: Array<{category, content}>` in the
original) are `annotations` here — "a note's notes" was confusing once
these became real records instead of a UI label.

## Dropped as dead code

Not carried forward — confirmed unused in the original repo (zero imports):
`recipe-step.tsx` (near-duplicate of `recipe-step-card.tsx`, which *is*
used), `recipe-editor-header.tsx`, `recipe-notes-panel.tsx`,
`theme-provider.tsx`.

## Status

Scaffolding stage: real folder structure + stub components/modules, so the
tree is right before code fills it in. Not yet implemented: actual
component markup/logic (ported from the original TSX), the `data/`
DixScript read/write layer, AI backend, sync.

## Docs

`docs/` — incident postmortems (`docs/incidents/`) and living rules learned
from them. Currently just one of each:
[`svelte5-effect-safety.md`](docs/svelte5-effect-safety.md) (the rule),
[`incidents/2026-08-22-effect-update-depth-exceeded.md`](docs/incidents/2026-08-22-effect-update-depth-exceeded.md)
(the incident that produced it). Read the rule doc before adding any new
`$effect` or `.svelte.ts` store function.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
