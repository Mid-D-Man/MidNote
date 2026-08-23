# Svelte 5 effect safety

The rule this codebase follows after the
[`effect_update_depth_exceeded` incident](incidents/2026-08-22-effect-update-depth-exceeded.md).
Read this before adding a new `$effect`, or a new function in any
`.svelte.ts` store, or a new call from inside an existing effect.

## The rule

> **An `$effect` must never — directly, or transitively through any
> function it calls — read a piece of `$state` and then (conditionally or
> unconditionally) write to that *same* piece of state.**

This applies even if the read and write happen inside a shared helper
function, not in the effect body itself, and even if the helper lives in
a completely different file. Svelte 5's dependency tracking has no file
or module scoping boundary — it's based on the call stack during the
effect's synchronous execution, not on where the code is lexically
written. A read three function calls deep is tracked exactly the same as
a read on the first line of the effect.

If the effect writes to that same state as a result, the write re-dirties
the effect that read it — which schedules that effect to run again. If
every rerun does the same read-then-write, that's not a slow leak, it's
an immediate infinite loop, and Svelte's own depth-exceeded guard is the
only thing that stops it (after burning real CPU time first — which is
why the on-device symptom was a hang, not an instant crash).

## Checklist before merging a new `$effect` or store function

1. **List everything this effect calls, transitively**, not just what it
   reads/writes directly in its own body. Include helper functions,
   store functions, logging calls — anything reachable synchronously
   from the effect.
2. **For each shared `$state` touched anywhere in that call graph**, ask:
   is it read to decide something (a dedupe check, a "does this already
   exist" check, a `findIndex`, comparing against a cached/previous
   value) and *also* written in the same call graph?
3. If yes, wrap the read — or the whole check-then-write block — in
   `untrack(() => { ... })` (imported from `"svelte"`). Writes inside
   `untrack` still work completely normally and still notify real
   subscribers (e.g. a component's own template read of that state) —
   `untrack` only stops the *read* from being registered as a dependency
   of whatever effect happens to be running when the code executes.
4. **Don't assume a branch is safe because it "only" does one write, or
   because it doesn't look like the pattern.** During this incident, the
   branch that looked safe on paper (`/note/new`, which only calls
   `breadcrumb()` once per effect run, not twice) still crashed when
   tested. Reasoning about which specific paths a reactive loop can or
   can't reach is unreliable — verify empirically instead (see below).
5. Run `npm run build && npm run smoke` before pushing. It's also wired
   into `ci-baby.yml`, but it's a lot faster to find out locally.

## Known-dangerous pattern

Any store function shaped like "check whether this already matches, then
write if it doesn't" — dedupe caches, `sync()`/`refresh()`-style
"reconcile from source of truth" functions, `findIndex` then `splice`:

```ts
// DANGEROUS if this function is ever called from inside an $effect
// (directly, or through something the effect calls):
export function upsert(item: Item) {
  const existing = items.find((i) => i.id === item.id);   // READ
  if (existing) Object.assign(existing, item);
  else items.push(item);                                    // WRITE
}
```

Fix: wrap the read (or the whole function body) in `untrack()`:

```ts
import { untrack } from "svelte";

export function upsert(item: Item) {
  untrack(() => {
    const existing = items.find((i) => i.id === item.id);
    if (existing) Object.assign(existing, item);
    else items.push(item);
  });
}
```

## Known-safe patterns

**An effect that only writes, never reads, the state it's setting up:**

```ts
$effect(() => {
  textareaEl = el; // el is a plain (non-$state) ref, not reactive at all
});
```

Zero tracked dependencies here (`el` isn't `$state`) — this effect runs
once and never reruns. Safe.

**An effect that reads one piece of state to derive another, and never
writes back to the thing it read:**

```ts
$effect(() => {
  lastCheckpoint = untrack(() => note.content); // read wrapped, write is to a different variable
});
```

This is the shape of the *first* fix in the incident this doc is named
after — reading `note.content` to set `lastCheckpoint` is fine in
principle (different variables), but `resetHistory()` is called from
inside the id-effect, which also reassigns `note` itself in the same
run — so the read of `note.content` needed `untrack()` too, since it's
reading a property of the very state the effect just wrote a few lines
earlier. When in doubt, `untrack()` the read.

**An unconditional write with no prior read of the same field:**

```ts
export function setTheme(mode: "dark" | "light") {
  theme.mode = mode; // no read of theme.mode above this — nothing to loop
}
```

Safe regardless of calling context.

## Verifying: the smoke test

`svelte-check` and `vite build` both pass clean on code with this bug —
neither one ever executes a component, so neither can catch a runtime
reactivity loop. `scripts/smoke-test.mjs` is the check that does: it
boots the *real* production build (`build/`, the actual `vite build`
output) in a headless DOM, for every scenario listed in the script, and
fails if any of them throw while mounting or settling.

```
npm run build
npm run smoke
```

Runs automatically in `ci-baby.yml` on every push/PR, right after the
Build step.

**When you add a new dynamic route** (a new `+page.svelte` under
`src/routes/.../[id]/`, or similar), add a line to the `SCENARIOS` array
in `scripts/smoke-test.mjs`. That's the entire maintenance cost.

**What it does and doesn't cover.** It boots each route and waits for
things to settle — this is exactly what would have caught the incident,
since the loop fired immediately on mount, no user interaction required.
It does *not* simulate arbitrary user interactions (typing, tapping
specific buttons) as part of the routine CI check — during this
incident's verification a one-off script additionally simulated typing
into the note and tapping Save, confirming the content actually
persisted to `localStorage`. That's a reasonable model to extend
`scripts/smoke-test-worker.mjs` with later (a few scripted interactions
per scenario, not just "did it mount") if a future bug turns out to need
an interaction to trigger, rather than firing on mount alone. Left out
of the routine check for now to keep it fast and simple; worth adding
if a future incident needs it.

**Why the worker runs as a separate process per scenario, not a loop in
one process** (`smoke-test.mjs` spawns `smoke-test-worker.mjs` as a child
per scenario): Svelte's client runtime and every `.svelte.ts` store hold
module-level singleton state. Import them twice in the same process and
you get the same instances back — state from scenario 1 (like
accumulated log entries, or the "already installed" flag on the global
error capture) would leak into scenario 2, which is both a source of
false negatives (a leftover effect from scenario 1 masking scenario 2's
own state) and false positives (stale state confusing a scenario that's
actually fine). A fresh process per scenario is the only way to
faithfully mirror "the app just launched," which is what actually
matters here.
