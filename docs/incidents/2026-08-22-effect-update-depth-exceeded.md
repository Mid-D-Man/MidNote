# Incident: `effect_update_depth_exceeded` on note/todo open

**Date:** 2026-08-22
**Status:** Fixed and verified. See [`svelte5-effect-safety.md`](../svelte5-effect-safety.md)
for the rule this incident exists to enforce going forward.

## Symptom

Opening an existing note (later, also opening/creating a todo) would hang
briefly, then the app went largely unresponsive: the textarea still
accepted typing, but every button — Save, the formatting toolbar, Delete —
showed its normal tap animation and then did nothing. Backgrounding and
resuming the app showed the note had actually saved correctly, which made
this look intermittent when it wasn't.

The debug panel (`src/lib/debug/log.svelte.ts` + `DebugPanel.svelte`,
built specifically because logcat isn't available on this workflow)
caught the real error:

```
Uncaught Error: https://svelte.dev/e/effect_update_depth_exceeded
    at yn (.../chunks/CSPvIjuk.js:1:2254)
    at Jn (.../chunks/CSPvIjuk.js:1:18570)
    at Ke.Ae (.../chunks/CSPvIjuk.js:1:14961)
    at Ke.Ae (.../chunks/CSPvIjuk.js:1:16006)
    at Ke.Ae (.../chunks/CSPvIjuk.js:1:16006)   [repeats ~hundreds of times]
```

— thrown from Svelte's own internal effect scheduler after an effect kept
re-running itself until Svelte's depth guard gave up. Reproduced
identically on multiple physical devices (different screen sizes), so it
was never device-specific.

## Root cause

`src/routes/note/[id]/+page.svelte` had a genuine instance of this bug
early on: an `$effect` that reassigned the `note` state and then, via
`resetHistory()`, read `note.content` back in the same synchronous call —
an effect that reads what it just wrote retriggers itself in Svelte 5.
That was found and fixed with `untrack()` around the read, and todo's
equivalent page got the same fix. **That fix was correct and is still in
place — it was not the bug that kept crashing after it.**

The bug that kept crashing lived one level down, in the shared logger
every page calls into: `src/lib/debug/log.svelte.ts`. `addLog()` (which
both `breadcrumb()` and the global `console.error`/`console.warn`
override funnel through) did this on every call:

```ts
const last = logs[logs.length - 1];  // READS the shared `logs` $state array
if (last && last.level === level && last.message === message) { ...; return; }
logs.push({ ... });                    // WRITES that same array
```

That read was never wrapped in `untrack()`. Both the note and todo pages'
id-driven `$effect`s call `breadcrumb()` more than once per run with
*different* messages (e.g. `"note page effect: id=X"` then, inside
`load()`, `"note: loaded X"`). Because the effect reads `logs` (via that
dedupe check) and then writes `logs` (via `push`) in the same run, and the
messages differ from each other, the dedupe never collapses them — so
`logs` genuinely mutates on every iteration. An effect that reads and
writes what it depends on retriggers itself forever. Same bug class as the
`note.content` one above, just hidden three calls deep inside a logging
utility instead of sitting in the effect body — which is exactly why it
wasn't caught by reviewing the four `$effect` blocks directly.

It's a little ironic: the tool built specifically to make this app
debuggable without a laptop was itself the thing crashing it.

### Why "typing still works but buttons don't"

Native `<textarea>` input doesn't need Svelte's reactivity to show a typed
character — that's the browser's own default behavior. But once the
runaway effect throws past Svelte's depth guard mid-flush, the reactivity
scheduler is left wedged. Click handlers still *run* (their own first line
is often a `breadcrumb()` call, which is why "Save tapped" etc. kept
appearing in the log even after the crash), but anything downstream that
depends on the scheduler recovering doesn't complete.

## Why the earlier reproduction missed it

An earlier debugging pass built a real reproduction (compiled the actual
`.svelte` source with `svelte/compiler`, mounted in jsdom) and correctly
confirmed the `note.content` fix resolved *that* loop. But isolating "does
`resetHistory`'s read-after-write on `note` loop" naturally means treating
logging as inert boilerplate — it's the obvious thing to not bother
mocking faithfully when you're isolating a different suspected cause.
That's the blind spot, not a mistake: the bug was never in the code being
tested, it was in a dependency of the test harness's own assumptions.

**Lesson for next time:** if a reproduction doesn't reproduce the crash,
that's evidence the reproduction is missing something real — not evidence
the code is fine. See the "verify against the real build" note in
[`svelte5-effect-safety.md`](../svelte5-effect-safety.md).

## The fix

`untrack()` around the read in `addLog()` — one function, fixes every
`breadcrumb()` and `console.error`/`console.warn` call site in the app at
once, rather than patching each caller individually (which would be
fragile: the next new effect that logs anything would reintroduce this).

Auditing every `.svelte.ts` store for the same shape (“read a shared
array to decide something, then conditionally write that same array”)
turned up three more instances, all in files with no currently-live
`$effect` caller:

- `src/lib/stores/entries.svelte.ts` — `refresh()`
- `src/lib/stores/tags.svelte.ts` — `sync()`
- `src/lib/stores/toast.svelte.ts` — `dismissToast()`

Not live bugs today (verified — exactly four `$effect` blocks exist in
the whole codebase at time of fix, none of them call into these), but
the identical latent shape. Closed the same way, preemptively, since the
most obvious next feature here — autosave-on-content-change via an
effect, replacing the current visibilitychange-only autosave — would
call straight into `saveEntry()` → `refresh()` from inside an effect and
reintroduce this exact bug class.

Files changed: `src/lib/debug/log.svelte.ts`,
`src/lib/stores/entries.svelte.ts`, `src/lib/stores/tags.svelte.ts`,
`src/lib/stores/toast.svelte.ts`. Nothing in the note/todo page files
needed to change — the fix already in place there was correct.

## Verification

`svelte-check --fail-on-warnings` and `vite build` both passed on the
*buggy* code — neither one ever mounts a component, so neither can catch
a runtime reactivity loop. Verification instead meant actually running
the real production build:

- **Unfixed `build/`, booted headlessly:** throws
  `effect_update_depth_exceeded` with a stack trace matching the
  on-device crash exactly — same minified frames (`yn`, `Jn`, `Ke.Ae`),
  same byte offsets, same chunk hash. Confirmed on all four dynamic-route
  variants (`/note/new`, `/note/<existing>`, `/todo/new`,
  `/todo/<existing>`), not only the one that had been manually observed
  crashing — don't trust manual reasoning about which paths a reactive
  loop can/can't reach; the "new" branch looked safe on paper (it only
  calls `breadcrumb` once per run in that branch, not twice) but crashed
  anyway, for reasons not worth fully re-deriving by hand when the actual
  test settles it.
- **Fixed `build/`, same scenarios:** zero errors, settles at a small
  bounded number of log lines instead of hundreds.
- **Full interaction test:** typed into the real textarea, tapped the
  real Save button by its `aria-label`, confirmed the new content
  actually landed in `localStorage` — the exact "type, then tap, nothing
  happens" sequence from the bug report, working end to end.

That verification is now permanent, not a one-off: `scripts/smoke-test.mjs`
runs the same real-build-boot check as a `npm run smoke` step in
`ci-baby.yml`, on every push. See
[`svelte5-effect-safety.md`](../svelte5-effect-safety.md) for the rule
going forward and what the smoke test does and doesn't cover.
