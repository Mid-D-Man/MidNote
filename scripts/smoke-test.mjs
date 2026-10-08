#!/usr/bin/env node
// Boots the REAL production build (build/, same output `npm run build`
// ships) for every scenario below, in a headless DOM, and fails if any
// of them throw while mounting/settling.
//
// Why this exists: svelte-check and `vite build` both pass clean on code
// that crashes the instant it actually runs — neither one ever executes
// a component. This is the check that does. It exists specifically
// because of the effect_update_depth_exceeded incident — see
// docs/incidents/2026-08-22-effect-update-depth-exceeded.md and
// docs/svelte5-effect-safety.md before touching any $effect or shared
// .svelte.ts store.
//
//   npm run build && npm run smoke     (manual)
//   .github/workflows/ci-baby.yml      (automatic, every push/PR)
//
// Add a line to SCENARIOS for any new dynamic route — that's the whole
// maintenance burden this asks of you going forward.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(REPO_ROOT, "build");
const WORKER = path.join(__dirname, "smoke-test-worker.mjs");

if (!existsSync(BUILD_DIR)) {
  console.error(`No build/ directory at ${BUILD_DIR} — run \`npm run build\` first.`);
  process.exit(1);
}

const now = new Date().toISOString();
const NOTE_ID = "smoke-test-note-0001";
const TODO_ID = "smoke-test-todo-0001";
const BOARD_ID = "smoke-test-board-0001";
const LONG_NOTE_ID = "smoke-test-long-note-0001";

const SEED_ENTRIES = [
  {
    id: NOTE_ID,
    type: "regular",
    title: "Smoke test note",
    content: "smoke test content",
    tags: [],
    lastModified: now,
    isBookmarked: false,
    encrypted: false,
  },
  {
    id: TODO_ID,
    type: "todo",
    title: "Smoke test todo",
    tags: [],
    lastModified: now,
    isBookmarked: false,
    encrypted: false,
    categories: ["Steps"],
    steps: [{ id: "s1", text: "step one", done: false, category: "Steps" }],
    annotations: [],
  },
  {
    id: BOARD_ID,
    type: "board",
    title: "Smoke test board",
    tags: [],
    lastModified: now,
    isBookmarked: false,
    encrypted: false,
    // Two nodes and a real edge between them, not an empty board — an
    // empty one would never exercise the node-type components or the
    // persisted-node -> xyflow-node conversion, which is where this
    // route's actual mount-time work happens.
    nodes: [
      { id: "bn1", kind: "text", x: 0, y: 0, label: "Node one", body: null, customIconId: null },
      { id: "bn2", kind: "image", x: 160, y: 0, label: "Node two", body: null, customIconId: null },
    ],
    edges: [{ id: "be1", source: "bn1", target: "bn2" }],
    // A saved viewport, so the "reopen where you left off" branch is
    // the one under test rather than the fitView fallback.
    viewport: { x: 0, y: 0, zoom: 1 },
  },
];

// Round 41: a note that is read in several pieces — a title piece, then one piece per
// paragraph (each paragraph is ~235 characters, so no two share a piece). Used to
// prove Resume carries on from the piece you paused on rather than from the top.
const para = (tag) => (tag + " " + "lorem ipsum dolor sit amet consectetur ".repeat(10)).slice(0, 234).trimEnd() + ".";
const LONG_NOTE = {
  id: LONG_NOTE_ID,
  type: "regular",
  title: "Long note",
  content: `<p>${para("ALPHA")}</p><p>${para("BRAVO")}</p><p>${para("CHARLIE")}</p><p>${para("DELTA")}</p>`,
  tags: [],
  lastModified: now,
  isBookmarked: false,
  encrypted: false,
};

// Every scenario that mounts a route component and runs its effects.
// "existing note/todo" is the one that actually caught the real bug —
// "new note/todo" never hit it (see the incident doc for why the two
// branches of load() behave differently) but stays here as a cheap
// regression net against a *different* future mistake in that branch.
//
// clickAriaLabel (round 24): added after a REAL on-device crash — every
// Save threw `DataCloneError` (storage.ts's upsertEntry structuredClone'd
// a live Svelte $state proxy, which the clone algorithm can't traverse —
// see storage.ts's clone() comment) — that every previous run of this
// file passed clean, because nothing here had ever clicked anything.
// Mounting a route and waiting was the whole test; tapping Save never
// happened. Each "— existing" scenario now actually taps its header's
// real Save button (matched by the same aria-label a screen reader
// would use) after the initial mount settles, so a crash inside that
// handler shows up here the same way it showed up on-device, instead of
// only in a debug log after the fact.
// Round 35: the seeded todo with two distinctly titled steps (for reorder/undo).
const TODO_TWO_STEPS = SEED_ENTRIES.map((e) =>
  e.id === TODO_ID
    ? {
        ...e,
        steps: [
          { id: "sA", category: "Steps", title: "AAA", content: "" },
          { id: "sB", category: "Steps", title: "BBB", content: "" },
        ],
      }
    : e
);

const SCENARIOS = [
  { name: "home / list page", path: "/", seed: SEED_ENTRIES },
  { name: "note — new", path: "/note/new", seed: SEED_ENTRIES },
  { name: "note — existing", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, clickAriaLabel: "Save" },
  { name: "todo — new", path: "/todo/new", seed: SEED_ENTRIES },
  { name: "todo — existing", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, clickAriaLabel: "Save" },
  { name: "board — new", path: "/board/new", seed: SEED_ENTRIES },
  // expectText: the one thing a crash-only check CAN'T catch — a route
  // that mounts cleanly, throws nothing, yet silently shows the WRONG
  // content (exactly what happened here: an existing board's canvas
  // seeded itself from the blank pre-load default and never re-synced
  // once the real saved nodes loaded a moment later — see
  // BoardCanvas.svelte's syncToken comment). Checked against the
  // settled page's real textContent — see smoke-test-worker.mjs's
  // SMOKE_EXPECT_TEXT handling. clickAriaLabel runs AFTER that check's
  // own settle wait, so this scenario covers both classes of bug.
  { name: "board — existing", path: `/board/${BOARD_ID}`, seed: SEED_ENTRIES, expectText: "Node one", clickAriaLabel: "Save" },
  // Round 26: the whole find & replace flow through the real UI —
  // Actions sheet -> row -> bar mounts (replacing the formatting toolbar)
  // -> typing a query highlights the match in the real Tiptap editor ->
  // Replace all rewrites the note text -> closing the bar restores the
  // toolbar. Seed note content is "smoke test content".
  {
    name: "note — find & replace",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "More" },
      { click: "Find and replace" },
      { expectSelector: '[aria-label="Find"]' },
      { type: { label: "Find", value: "smoke" } },
      { wait: 500 },
      { expectSelector: ".find-match" },
      { expectText: "1 of 1" },
      { type: { label: "Replace with", value: "SMOKE" } },
      { click: "Replace all" },
      { expectText: "SMOKE test content" },
      { expectText: "Replaced 1" },
      { click: "Close find and replace" },
      { expectSelector: '[aria-label="Undo"]' },
    ],
  },
  // Round 27: a paste through the real built editor. Asserts the handler
  // is actually wired (the event is cancelled), the pasted lines land in
  // the note, and the diagnostics breadcrumb reaches the on-device debug
  // panel — the same "it mounts" trap rounds 24 and 26 kept hitting, for
  // the paste path this time. Text is long enough (>40 chars) to log.
  {
    name: "note — paste",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { paste: "pasted line one is long enough to be logged\npasted line two\n\npasted line four" },
      { wait: 400 },
      { expectText: "pasted line two" },
      { expectText: "pasted line four" },
      { expectText: "paste event:" },
    ],
  },
  // Round 29: checklist through the real toolbar button and the real
  // Tiptap checkbox node view. The checkbox is clicked and the DOM must
  // reflect data-checked=true — a checklist that renders but ignores taps
  // would pass a mount-only test.
  {
    name: "note — checklist",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "Checklist" },
      { expectSelector: 'ul[data-type="taskList"]' },
      { clickSelector: 'ul[data-type="taskList"] > li input[type="checkbox"]' },
      { expectSelector: 'ul[data-type="taskList"] > li[data-checked="true"]' },
    ],
  },
  // Round 29: the Actions-sheet rows added this round. Pin round-trips
  // (Pin -> Unpin, which also proves the row label follows the saved
  // state); Ask AI opens the stub sheet, a message can be typed and sent,
  // and the "not connected" notice appears (nothing pretends to be real).
  {
    name: "note — pin + ask AI",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "More" },
      { click: "Pin note" },
      { expectText: "Pinned" },
      { click: "More" },
      { click: "Unpin note" },
      { expectText: "Unpinned" },
      { click: "More" },
      { click: "Ask AI" },
      { type: { label: "Message AI", value: "summarise this" } },
      { wait: 300 },
      { click: "Send message" },
      { expectText: "summarise this" },
      { expectText: "isn't connected yet" },
    ],
  },
  // Round 30: Export as… — real documents are built from the seeded note
  // and the recorded download's actual bytes are checked (PDF starts
  // "%PDF-", DOCX is a zip so starts "PK"), for all three entry types.
  {
    name: "note — export as PDF + Word",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "More" },
      { click: "Export as" },
      { click: "Export as PDF" },
      { wait: 500 },
      { expectText: "Exported" },
      { expectDownload: { ext: ".pdf", magic: "%PDF-", minBytes: 700 } },
      { click: "More" },
      { click: "Export as" },
      { click: "Export as Word document" },
      { wait: 500 },
      { expectDownload: { ext: ".docx", magic: "PK", minBytes: 1500 } },
    ],
  },
  {
    name: "todo — export as PDF",
    path: `/todo/${TODO_ID}`,
    seed: SEED_ENTRIES,
    steps: [{ click: "More" }, { click: "Export as" }, { click: "Export as PDF" }, { wait: 500 }, { expectDownload: { ext: ".pdf", magic: "%PDF-", minBytes: 700 } }],
  },
  {
    name: "board — export as Word",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    steps: [{ click: "More" }, { click: "Export as" }, { click: "Export as Word document" }, { wait: 500 }, { expectDownload: { ext: ".docx", magic: "PK", minBytes: 1500 } }],
  },
  // Round 30: Comments. Post two, confirm both reach STORAGE (saveEntry),
  // then delete one with the two-tap confirm and confirm it left storage
  // too — a comment that shows on screen but never persists would pass a
  // mount-only test.
  {
    name: "note — comments",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "More" },
      { click: "Comments" },
      { type: { label: "Add a comment", value: "first remark zq1" } },
      { wait: 200 },
      { click: "Post comment" },
      { expectText: "first remark zq1" },
      { expectStored: "first remark zq1" },
      { type: { label: "Add a comment", value: "second remark zq2" } },
      { wait: 200 },
      { click: "Post comment" },
      { expectText: "second remark zq2" },
      { click: "Delete comment" },
      { expectText: "Delete?" },
      { click: "Confirm delete comment" },
      { expectText: "Comment deleted" },
      { expectNotStored: "first remark zq1" },
      { expectStored: "second remark zq2" },
    ],
  },
  // Round 31: Reminder, against a recording fake of the Android notification
  // plugin (the real one can't run in jsdom). Checks the whole chain a user
  // triggers: the sheet -> the backend calls (exact time, once) -> the saved
  // `reminderAt` in storage -> delete cancels the alarm AND clears storage.
  // Times are set in UTC (see TZ in runScenario), so the asserted ISO string
  // is exact.
  {
    name: "note — reminder set + delete",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    reminderBackend: true,
    steps: [
      { click: "More" },
      { click: "Reminder" },
      { expectText: "Select time" },
      { type: { label: "Reminder time", value: "12:00" } },
      { type: { label: "Reminder date", value: "2099-01-01" } },
      { wait: 200 },
      { click: "Set reminder" },
      { wait: 300 },
      { expectText: "Reminder set" },
      { expectGlobalCount: { name: "__reminderCalls", substring: "schedule:", count: 1 } },
      { expectGlobalIncludes: { name: "__reminderCalls", substring: "2099-01-01T12:00:00.000Z:Smoke test note" } },
      { expectStored: '"reminderAt":"2099-01-01T12:00:00.000Z"' },
      { click: "More" },
      { click: "Reminder" },
      { expectText: "Delete reminder" },
      { click: "Delete reminder" },
      { wait: 300 },
      { expectText: "Reminder deleted" },
      { expectGlobalCount: { name: "__reminderCalls", substring: "cancel:", count: 2 } },
      { expectNotStored: "2099-01-01T12:00:00.000Z" },
    ],
  },
  // A past time must be refused on screen and must never reach the plugin
  // (which would silently drop it and still report success).
  {
    name: "note — reminder in the past refused",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    reminderBackend: true,
    steps: [
      { click: "More" },
      { click: "Reminder" },
      { type: { label: "Reminder time", value: "10:00" } },
      { type: { label: "Reminder date", value: "2000-01-01" } },
      { wait: 200 },
      { click: "Set reminder" },
      { wait: 200 },
      { expectText: "Pick a time in the future" },
      { expectGlobalCount: { name: "__reminderCalls", substring: "schedule:", count: 0 } },
      { expectNotStored: '"reminderAt":"2000' },
    ],
  },
  // A quick-pick chip fills the fields and the default flow works end to end.
  {
    name: "note — reminder preset",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    reminderBackend: true,
    steps: [
      { click: "More" },
      { click: "Reminder" },
      { click: "Tomorrow 9 AM" },
      { click: "Set reminder" },
      { wait: 300 },
      { expectText: "Reminder set" },
      { expectGlobalIncludes: { name: "__reminderCalls", substring: "T09:00:00.000Z" } },
    ],
  },
  {
    name: "todo — reminder",
    path: `/todo/${TODO_ID}`,
    seed: SEED_ENTRIES,
    reminderBackend: true,
    steps: [{ click: "More" }, { click: "Reminder" }, { click: "Set reminder" }, { wait: 300 }, { expectText: "Reminder set" }, { expectGlobalIncludes: { name: "__reminderCalls", substring: "Smoke test todo" } }],
  },
  {
    name: "board — reminder",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    reminderBackend: true,
    steps: [{ click: "More" }, { click: "Reminder" }, { click: "Set reminder" }, { wait: 300 }, { expectText: "Reminder set" }, { expectGlobalIncludes: { name: "__reminderCalls", substring: "Smoke test board" } }],
  },
  // No Android / no plugin (a desktop or browser preview): the sheet says so
  // instead of pretending, and nothing can be scheduled.
  {
    name: "note — reminder unsupported here",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [{ click: "More" }, { click: "Reminder" }, { expectText: "installed Android app" }, { expectNoText: "Set reminder" }],
  },
  // A note whose reminder is in the future shows the bell on its list card.
  {
    name: "home — reminder bell on card",
    path: "/",
    seed: SEED_ENTRIES.map((e) => (e.id === NOTE_ID ? { ...e, reminderAt: "2099-01-01T12:00:00.000Z" } : e)),
    steps: [{ expectSelector: ".reminder-badge" }],
  },
  { name: "todo — pin", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Pin todo" }, { expectText: "Pinned" }] },
  // Round 34: rename a todo's sub-category through the real UI. Asserts the
  // new name is what got SAVED (the step's own `category` field moved with
  // it, not just the tab label) and the old name is gone from storage — a
  // rename that only relabelled the tab would leave the step filed under a
  // category that no longer exists.
  {
    name: "todo — rename category",
    path: `/todo/${TODO_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "Rename category" },
      { type: { label: "Category name", value: "Chores" } },
      { click: "Save category name" },
      { expectText: "Chores" },
      { expectStored: '"category":"Chores"' },
      { expectNotStored: '"category":"Steps"' },
    ],
  },
  { name: "todo — rename category blank refused", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, steps: [{ click: "Rename category" }, { type: { label: "Category name", value: "   " } }, { click: "Save category name" }, { expectText: "Give the category a name" }, { expectStored: '"category":"Steps"' }] },
  // Round 34: Share (note/todo/board) hands the entry's text to the native
  // share sheet. The fake sheet records what it was given, so this proves the
  // tap really reaches it with the entry's own title + content (the old code
  // never got past "Sharing isn't available here" / "coming soon").
  { name: "note — share", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, share: "fake", steps: [{ click: "More" }, { click: "Share" }, { wait: 200 }, { expectGlobalIncludes: { name: "__shareCalls", substring: "native:Smoke test note" } }, { expectNoText: "Sharing isn't available" }] },
  { name: "todo — share", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, share: "fake", steps: [{ click: "More" }, { click: "Share" }, { wait: 200 }, { expectGlobalIncludes: { name: "__shareCalls", substring: "native:Smoke test todo" } }, { expectNoText: "coming soon" }] },
  { name: "board — share", path: `/board/${BOARD_ID}`, seed: SEED_ENTRIES, share: "fake", steps: [{ click: "More" }, { click: "Share" }, { wait: 200 }, { expectGlobalIncludes: { name: "__shareCalls", substring: "native:Smoke test board" } }] },
  // Android reports "cancelled" even after a successful send: no toast either way.
  { name: "note — share cancelled is silent", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, share: "cancel", steps: [{ click: "More" }, { click: "Share" }, { wait: 200 }, { expectGlobalIncludes: { name: "__shareCalls", substring: "native:" } }, { expectNoText: "Couldn" }, { expectNoText: "Copied to clipboard" }] },
  // Round 34: Markdown export. Real bytes, starting with the title as an H1.
  { name: "note — export markdown", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Export as" }, { click: "Export as Markdown" }, { wait: 500 }, { expectDownload: { ext: ".md", magic: "# Smoke test note", minBytes: 20 } }] },
  { name: "todo — export markdown", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Export as" }, { click: "Export as Markdown" }, { wait: 500 }, { expectDownload: { ext: ".md", magic: "# Smoke test todo", minBytes: 20 } }] },
  // Round 34: the top-bar download button opens the same format picker (it
  // used to write a .txt straight away), so a single tap path reaches Markdown.
  { name: "note — top-bar export opens picker", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, steps: [{ click: "Export" }, { expectSelector: '[aria-label="Export as Markdown"]' }, { expectSelector: '[aria-label="Export as PDF"]' }, { click: "Export as Markdown" }, { wait: 500 }, { expectDownload: { ext: ".md", magic: "# Smoke test note", minBytes: 20 } }] },
  // Round 34: editing a comment through the real sheet. Post one, edit it,
  // and the SAVED text is the edited one (the old text is gone from storage).
  {
    name: "note — edit comment",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "More" },
      { click: "Comments" },
      { type: { label: "Add a comment", value: "first draft remark" } },
      { click: "Post comment" },
      { expectStored: "first draft remark" },
      { click: "Edit comment" },
      { expectText: "Editing comment" },
      { type: { label: "Edit comment text", value: "revised remark" } },
      { click: "Save comment" },
      { expectStored: "revised remark" },
      { expectNotStored: "first draft remark" },
      { expectNoText: "Editing comment" },
    ],
  },
  // Round 35: removing the SELECTED category when exactly two exist. The tabs
  // component decided the next selection by re-reading `categories.length`
  // AFTER the removal (so "2 before" looked like "1 after"), skipped the
  // switch, and left the editor on a category that no longer existed — an
  // empty list whose "Add Step" filed steps under a dead name, invisible
  // everywhere. The surviving tab must become the active one.
  {
    name: "todo — remove selected category lands on the survivor",
    path: `/todo/${TODO_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "Add category" },
      { type: { label: "New category name", value: "Extra" } },
      { click: "Save new category" },
      { expectSelector: ".tab-pill.active" },
      { click: "Remove Extra" },
      // Exactly one tab is left, and it is the active one. (The Undo toast
      // itself mentions "Extra", so this checks the tabs, not the page text.)
      { expectSelector: ".tab-pill-wrap:only-child .tab-pill.active" },
    ],
  },
  // Round 35: todo editor — undo, reorder, move. The two-step seed has
  // distinctly titled steps so an order change is visible in storage.
  {
    name: "todo — delete step, undo brings it back",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { click: "Delete step" },
      { expectText: "Step deleted" },
      { expectNotStored: "AAA" },
      { click: "Undo" },
      { expectStored: "AAA" },
      { expectNoText: "Step deleted" },
      { expectStoredOrder: ["AAA", "BBB"] },
    ],
  },
  {
    name: "todo — remove category + its steps, undo restores both",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { click: "Add category" },
      { type: { label: "New category name", value: "Extra" } },
      { click: "Save new category" },
      { click: "Add step" },
      { expectStored: '"category":"Extra"' },
      { click: "Remove Extra" },
      { expectText: "Removed" },
      { expectNotStored: '"category":"Extra"' },
      { click: "Undo" },
      { expectStored: '"category":"Extra"' },
      { expectSelector: ".tab-pill.active" },
    ],
  },
  {
    name: "todo — move step down reorders storage",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { expectSelector: '[aria-label="Move step up"][disabled]' },
      { click: "Move step down" },
      { expectStoredOrder: ["BBB", "AAA"] },
    ],
  },
  {
    name: "todo — move step to another category",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { click: "Add category" },
      { type: { label: "New category name", value: "Extra" } },
      { click: "Save new category" },
      { clickSelector: ".tab-pill-wrap:nth-child(1) .tab-pill" },
      { type: { label: "Move step to category", value: "Extra" } },
      { expectText: "Step moved" },
      { expectStored: '"title":"AAA","content":""' },
    ],
  },
  // Round 36: step checkboxes. The seed's steps have NO `done` field (the
  // shape saved before this round), so this also proves old data loads as
  // "not done" and that ticking is stored as a real boolean. The category tab
  // gets its check mark only when EVERY step in it is ticked, and loses it
  // again when one is unticked.
  {
    name: "todo — step checkboxes and category all-done",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { expectNoSelector: ".tab-pill.all-done" },
      { expectSelector: '[aria-label="0 of 2 steps done"]' },
      { click: "Mark step 1 done" },
      { expectStored: '"done":true' },
      { expectStored: '"done":false' },
      { expectSelector: '[aria-label="1 of 2 steps done"]' },
      { expectNoSelector: ".tab-pill.all-done" },
      { click: "Mark step 2 done" },
      { expectSelector: ".tab-pill.all-done" },
      { expectText: "all steps done" },
      { expectSelector: '[aria-label="2 of 2 steps done"]' },
      { click: "Mark step 1 not done" },
      { expectNoSelector: ".tab-pill.all-done" },
      { expectSelector: '[aria-label="1 of 2 steps done"]' },
    ],
  },
  // A todo with no steps must not claim to be complete (zero of zero is not "all done").
  { name: "todo — empty category is not all-done", path: "/todo/new", seed: SEED_ENTRIES, steps: [{ expectSelector: ".tab-pill" }, { expectNoSelector: ".tab-pill.all-done" }] },
  // Round 37: read aloud. The fake speech engine records what it is asked to say.
  // The whole session plays out: Read aloud -> engine is asked to speak the
  // note (title first, FLUSH mode) -> the Stop bar is on screen -> the engine
  // reports it has gone quiet -> the bar goes away by itself.
  {
    name: "note — read aloud, runs to the end",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 300 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "speak:flush:default:1:Smoke test note." } },
      { expectSelector: '[aria-label="Stop reading"]' },
      { expectSelector: '[aria-label="Pause reading"]' },
      { wait: 2600 },
      // Finished by itself: the bar stays, offering Replay, until it is closed.
      { expectNoSelector: '[aria-label="Stop reading"]' },
      { expectText: "Finished" },
      { expectSelector: '[aria-label="Replay reading"]' },
      { click: "Close reading bar" },
      { expectNoSelector: ".bar" },
    ],
  },
  // Round 40: Pause stops the engine and shows Paused; Resume speaks again (a SECOND
  // speak call, flush mode) and goes back to Reading; Replay speaks it from the start.
  {
    name: "note — read aloud pause, resume, replay",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:Smoke test note.", count: 1 } },
      { click: "Pause reading" },
      { wait: 100 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "stop", count: 1 } },
      { expectText: "Paused" },
      { expectSelector: '[aria-label="Resume reading"]' },
      { expectNoSelector: '[aria-label="Pause reading"]' },
      // still paused a couple of poll cycles later — the watcher must not "finish" it
      { wait: 1800 },
      { expectText: "Paused" },
      { click: "Resume reading" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:Smoke test note.", count: 2 } },
      { expectSelector: '[aria-label="Pause reading"]' },
      { expectText: "Reading…" },
      { click: "Replay reading" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:Smoke test note.", count: 3 } },
      { expectSelector: '[aria-label="Pause reading"]' },
    ],
  },
  // Round 41: Resume carries on from the piece that was being spoken. The note is read
  // as: "Long note." -> ALPHA -> BRAVO -> CHARLIE -> DELTA. Paused during BRAVO, Resume
  // must say BRAVO again (flush) — never the title, never ALPHA.
  {
    name: "note — read aloud, Resume carries on from where you paused",
    path: `/note/${LONG_NOTE_ID}`,
    seed: [...SEED_ENTRIES, LONG_NOTE],
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 3600 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "speak:add:default:1:BRAVO" } },
      { expectGlobalCount: { name: "__ttsCalls", substring: "CHARLIE", count: 0 } },
      { click: "Pause reading" },
      { wait: 150 },
      { expectText: "Paused" },
      { wait: 1600 },
      { expectText: "Paused" },
      { click: "Resume reading" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:BRAVO", count: 1 } },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:Long note.", count: 1 } },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:ALPHA", count: 0 } },
      { expectText: "Reading…" },
      // and it keeps going to the end from there
      { wait: 4600 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "speak:add:default:1:DELTA" } },
    ],
  },
  // The same, with an engine whose events never reach the app (what the phone did): the
  // position still can't be lost, because it no longer comes from the events. Without
  // events the end of a piece is found by polling, with a floor tied to how long the
  // text should take to say (a real voice takes that long; this fake is much faster),
  // so ALPHA is still "being spoken" at 4 s. Paused there, Resume says ALPHA again.
  {
    name: "note — read aloud, Resume carries on from where you paused (no engine events)",
    path: `/note/${LONG_NOTE_ID}`,
    seed: [...SEED_ENTRIES, LONG_NOTE],
    tts: "noevents",
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 4000 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "speak:add:default:1:ALPHA" } },
      { expectGlobalCount: { name: "__ttsCalls", substring: "BRAVO", count: 0 } },
      { click: "Pause reading" },
      { wait: 150 },
      { expectText: "Paused" },
      { click: "Resume reading" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:ALPHA", count: 1 } },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:Long note.", count: 1 } },
      { expectText: "Reading…" },
    ],
  },
  // Replay after it has finished reads it again from the start.
  {
    name: "note — read aloud replay after it finished",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 2800 },
      { expectText: "Finished" },
      { click: "Replay reading" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:Smoke test note.", count: 2 } },
      { expectText: "Reading…" },
      { expectSelector: '[aria-label="Stop reading"]' },
    ],
  },
  // From the finished state the Actions row offers "Read aloud" again, not "Stop reading".
  {
    name: "note — actions row after it finished",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [{ click: "More" }, { click: "Read aloud" }, { wait: 2800 }, { expectText: "Finished" }, { click: "More" }, { expectSelector: '[aria-label="Read aloud"]' }, { expectNoSelector: '[aria-label="Stop reading"]' }],
  },
  // Stop: the engine is told to stop and the bar is gone straight away.
  {
    name: "note — read aloud, stop",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 300 },
      { expectSelector: '[aria-label="Stop reading"]' },
      { click: "Stop reading" },
      { wait: 100 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "stop" } },
      { expectNoSelector: '[aria-label="Stop reading"]' },
    ],
  },
  // Leaving the editor stops the reading — it must not keep talking from a page
  // you are no longer on.
  {
    name: "note — read aloud stops when you leave the page",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 300 },
      { expectSelector: '[aria-label="Stop reading"]' },
      { click: "Back" },
      { wait: 400 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "stop" } },
      { expectNoSelector: '[aria-label="Stop reading"]' },
    ],
  },
  // Round 38: read ONLY the selected text. Ctrl+A selects the body; the toolbar
  // then offers "Read selection aloud", and what the engine is asked to say is
  // the body — NOT the title that a whole-note read starts with.
  {
    name: "note — read selection aloud",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { expectNoSelector: '[aria-label="Read selection aloud"]' },
      { press: { selector: ".ProseMirror", key: "a", ctrl: true } },
      { expectSelector: '[aria-label="Read selection aloud"]' },
      { click: "Read selection aloud" },
      { wait: 300 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "speak:flush:default:1:smoke test content." } },
      { expectSelector: '[aria-label="Stop reading"]' },
    ],
  },
  // The bar rides above the editor's bottom panel (the lift is published by the
  // note page) and sits in the plain bottom slot on a page with no panel.
  { name: "note — reading bar rides above the panel", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, tts: true, steps: [{ click: "More" }, { click: "Read aloud" }, { wait: 300 }, { expectSelector: '[aria-label="Stop reading"]' }, { expectSelector: '.bar[data-lift="8"]' }] },
  { name: "todo — reading bar sits in the plain bottom slot", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, tts: true, steps: [{ click: "More" }, { click: "Read aloud" }, { wait: 300 }, { expectSelector: '.bar[data-lift="0"]' }] },
  // A todo is read as categories and numbered steps, with ticked ones marked.
  {
    name: "todo — read aloud",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    tts: true,
    steps: [
      { click: "Mark step 1 done" },
      { click: "More" },
      { click: "Read aloud" },
      { wait: 300 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "Category: Steps." } },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "Step 1, done: AAA." } },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "Step 2: BBB." } },
    ],
  },
  // Settings -> Advanced settings -> Read aloud: pick a voice, change the speed, play the sample — the
  // sample is spoken with exactly the chosen voice and speed, and both are saved.
  {
    name: "settings — read aloud voice, speed, sample",
    path: "/",
    seed: SEED_ENTRIES,
    tts: true,
    steps: [
      { click: "Open menu" },
      { click: "Open settings" },
      { click: "Open advanced settings" },
      { wait: 300 },
      { click: "Open Read aloud settings" },
      { wait: 300 },
      { expectSelector: '[aria-label="Voices"]' },
      // Opens on the phone's own language (jsdom reports en-US): English voices
      // are listed, French ones are one language-filter change away.
      { expectSelector: '[aria-label="Voice English (United States) · aaa · Local"]' },
      { expectNoSelector: '[aria-label="Voice French (France) · ccc · Local"]' },
      { type: { label: "Voice language", value: "fr" } },
      { expectNoSelector: '[aria-label="Voice English (United States) · aaa · Local"]' },
      { click: "Voice French (France) · ccc · Local" },
      { expectStored: "fr-fr-x-ccc-local" },
      { type: { label: "Speech speed", value: "1.5" } },
      { expectStored: '"rate":1.5' },
      { click: "Play sample" },
      { wait: 200 },
      { expectGlobalIncludes: { name: "__ttsCalls", substring: "speak:flush:fr-fr-x-ccc-local:1.5:This is how your notes will sound" } },
      { click: "Voice Default" },
      { expectNotStored: "fr-fr-x-ccc-local" },
    ],
  },
  // Without the Android engine (a browser tab, desktop) Read aloud says so instead of failing silently.
  { name: "note — read aloud without the engine", path: `/note/${NOTE_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Read aloud" }, { wait: 200 }, { expectText: "Read aloud works in the Android app" }, { expectNoSelector: '[aria-label="Stop reading"]' }] },
  // Round 38: the todo CARD on the landing page shows progress. Ticking steps in
  // the editor changes the card's line and bar; ticking them all marks it complete.
  {
    name: "todo — card shows progress",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { click: "Mark step 1 done" },
      { click: "Back" },
      { wait: 400 },
      { clickSelector: ".view-tabs button:nth-child(2)" },
      { expectText: "1/2 steps done" },
      { expectSelector: '.todo-progress[aria-label="1 of 2 steps done"]' },
      { expectNoSelector: ".todo-progress.complete" },
    ],
  },
  {
    name: "todo — card marks a finished todo",
    path: `/todo/${TODO_ID}`,
    seed: TODO_TWO_STEPS,
    steps: [
      { click: "Mark step 1 done" },
      { click: "Mark step 2 done" },
      { click: "Back" },
      { wait: 400 },
      { clickSelector: ".view-tabs button:nth-child(2)" },
      { expectText: "All 2 steps done" },
      { expectSelector: ".todo-progress.complete" },
    ],
  },
  { name: "todo — card with nothing ticked shows the plain count", path: "/", seed: TODO_TWO_STEPS, steps: [{ clickSelector: ".view-tabs button:nth-child(2)" }, { expectText: "2 steps" }, { expectNoSelector: ".todo-progress" }] },
  // Round 38: boards. Tapping a node opens its sheet, which now lists the lines
  // attached to it. This first scenario only proves the plumbing: the node tap
  // reaches the sheet and the seeded line shows up as a connection to "Node two".
  {
    name: "board — node sheet lists its connections",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { clickSelector: '.svelte-flow__node[data-id="bn1"]' },
      { expectText: "Connections" },
      { expectSelector: '[aria-label="Caption for Node two →"]' },
      { expectSelector: '[aria-label="Arrow on Node two →"]' },
    ],
  },
  // Round 38: connection captions and arrows, through the real node sheet. The
  // seeded line has neither (the shape saved before this round) — so this also
  // proves old boards load as "plain line, no caption" and that both edits reach
  // storage as real values.
  {
    name: "board — connection caption and arrow",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { expectNotStored: '"directed":true' },
      { clickSelector: '.svelte-flow__node[data-id="bn1"]' },
      { type: { label: "Caption for Node two →", value: "mother of" } },
      { press: { selector: '[aria-label="Caption for Node two →"]', key: "Enter" } },
      { expectStored: '"label":"mother of"' },
      { click: "Arrow on Node two →" },
      { expectStored: '"directed":true' },
      { click: "Arrow on Node two →" },
      { expectNotStored: '"directed":true' },
    ],
  },
  // Removing a connection is undoable, and the undo brings back the SAME line
  // (id, and the caption it had).
  {
    name: "board — remove connection, undo",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { clickSelector: '.svelte-flow__node[data-id="bn1"]' },
      { type: { label: "Caption for Node two →", value: "keeps this" } },
      { press: { selector: '[aria-label="Caption for Node two →"]', key: "Enter" } },
      { click: "Remove connection Node two →" },
      { expectText: "Connection removed" },
      { expectNotStored: '"id":"be1"' },
      { click: "Undo" },
      { expectStored: '"id":"be1"' },
      { expectStored: '"label":"keeps this"' },
    ],
  },
  // Deleting a node takes its lines with it; Undo returns both.
  {
    name: "board — delete node with its connection, undo",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { clickSelector: '.svelte-flow__node[data-id="bn1"]' },
      { click: "Delete node" },
      { expectText: "Node deleted with 1 connection" },
      { expectNotStored: '"id":"bn1"' },
      { expectNotStored: '"id":"be1"' },
      { click: "Undo" },
      { expectStored: '"id":"bn1"' },
      { expectStored: '"id":"be1"' },
    ],
  },
  // Duplicate makes a second node (new id), leaving the first and its line alone.
  {
    name: "board — duplicate node",
    path: `/board/${BOARD_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { expectNoSelector: ".svelte-flow__nodes > .svelte-flow__node:nth-child(3)" },
      { clickSelector: '.svelte-flow__node[data-id="bn1"]' },
      { click: "Duplicate node" },
      { wait: 200 },
      { expectSelector: ".svelte-flow__nodes > .svelte-flow__node:nth-child(3)" },
      { expectStored: '"id":"bn1"' },
      { expectStored: '"id":"be1"' },
    ],
  },
  // Adding nodes still works, and two in a row are two nodes (placement is covered by logic tests).
  { name: "board — add two nodes", path: `/board/${BOARD_ID}`, seed: SEED_ENTRIES, steps: [{ click: "Add text node" }, { click: "Add text node" }, { wait: 200 }, { expectSelector: ".svelte-flow__nodes > .svelte-flow__node:nth-child(4)" }, { expectNoSelector: ".svelte-flow__nodes > .svelte-flow__node:nth-child(5)" }] },
  // Round 39: comments are a NOTE feature, one list per page. Todos and boards no longer offer them.
  { name: "todo — no Comments row", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { expectSelector: '[aria-label="Export as"]' }, { expectNoSelector: '[aria-label="Comments"]' }] },
  { name: "board — no Comments row", path: `/board/${BOARD_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { expectSelector: '[aria-label="Export as"]' }, { expectNoSelector: '[aria-label="Comments"]' }] },
  // A comment written on page 1 is NOT shown on page 2, and page 2 has its own. The
  // Actions row counts only the page you are on, and the sheet's title names the page.
  {
    name: "note — comments are per page",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "More" },
      { click: "Comments" },
      { type: { label: "Add a comment", value: "only on page one" } },
      { click: "Post comment" },
      { expectText: "only on page one" },
      { expectStored: '"pageId":"page-1"' },
      { clickSelector: ".scrim" },
      { wait: 400 },
      { click: "More" },
      { expectText: "Comments (1)" },
      { click: "Pages" },
      { click: "Add page" },
      { wait: 300 },
      { click: "More" },
      { expectNoText: "Comments (1)" },
      { click: "Comments" },
      { expectText: "Comments · Page 2" },
      { expectNoText: "only on page one" },
      { expectText: "No comments on this page yet" },
      { type: { label: "Add a comment", value: "only on page two" } },
      { click: "Post comment" },
      { expectText: "only on page two" },
      { clickSelector: ".scrim" },
      { wait: 400 },
      { click: "More" },
      { click: "Pages" },
      { click: "Go to Page 1" },
      { wait: 300 },
      { click: "More" },
      { expectText: "Comments (1)" },
      { click: "Comments" },
      { expectText: "only on page one" },
      { expectNoText: "only on page two" },
      { expectStored: "only on page two" },
    ],
  },
  { name: "board — pin", path: `/board/${BOARD_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Pin board" }, { expectText: "Pinned" }] },
  // Round 33: the toolbar's font picker through the real editor. The note
  // has no selection, so choosing a font sets a STORED MARK at the caret;
  // the picker reads it back through editor.getAttributes, so "Font Mono"
  // turning pressed proves the command ran in the real Tiptap editor (a
  // missing FontFamily extension makes setFontFamily throw and fails this).
  {
    name: "note — font picker",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    steps: [
      { click: "Text font" },
      { expectSelector: '[aria-label="Font list"]' },
      { expectSelector: '[aria-label="Font Default"][aria-pressed="true"]' },
      { click: "Font Mono" },
      { expectSelector: '[aria-label="Font Mono"][aria-pressed="true"]' },
      { click: "Font Serif" },
      { expectSelector: '[aria-label="Font Serif"][aria-pressed="true"]' },
      { click: "Font Default" },
      { expectSelector: '[aria-label="Font Default"][aria-pressed="true"]' },
      { click: "Close" },
      { expectNoText: "Add your own fonts in Settings" },
    ],
  },
  // Round 33/42: Settings -> Advanced settings -> Appearance -> Fonts. The page opens, the
  // default note font can be chosen, and the choice reaches localStorage
  // (the note editor reads it from there on its next load).
  {
    name: "settings — fonts + default font",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { click: "Open menu" },
      { click: "Open settings" },
      { click: "Open advanced settings" },
      { wait: 300 },
      { click: "Open Appearance settings" },
      { wait: 300 },
      { click: "Open fonts settings" },
      { wait: 300 },
      { expectText: "Default note font" },
      { expectText: "No fonts imported yet" },
      { expectSelector: '[aria-label="Import font"]' },
      { click: "Default font Mono" },
      { expectSelector: '[aria-label="Default font Mono"][aria-pressed="true"]' },
      { expectStored: "ui-monospace, Consolas, monospace" },
      { click: "Default font Default" },
      { expectNotStored: "ui-monospace, Consolas, monospace" },
    ],
  },
  // Round 42: the Settings PANEL holds only the basics; "Advanced settings" opens a page.
  {
    name: "settings — panel holds the basics, Advanced settings opens the page",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { click: "Open menu" },
      { click: "Open settings" },
      { expectSelector: '[aria-label="Open theme settings"]' },
      { expectSelector: '[aria-label="Show note lines"]' },
      { expectSelector: '[aria-label="Open advanced settings"]' },
      { expectNoSelector: '[aria-label="Open fonts settings"]' },
      { expectNoSelector: '[aria-label="Open read aloud settings"]' },
      { expectNoSelector: '[aria-label="Show debug panel"]' },
      { click: "Open advanced settings" },
      { wait: 400 },
      { expectText: "Advanced settings" },
      { expectSelector: '[aria-label="Open Appearance settings"]' },
      { expectSelector: '[aria-label="Open Read aloud settings"]' },
      { expectSelector: '[aria-label="Open Trash settings"]' },
      { expectSelector: '[aria-label="Open Privacy & security settings"]' },
      { expectSelector: '[aria-label="Open Developer settings"]' },
      // the panel is closed behind the page
      { expectNoSelector: '[aria-label="Open advanced settings"]' },
    ],
  },
  // Back buttons climb one level at a time: Fonts -> Appearance -> Advanced settings -> the notes list.
  {
    name: "settings — Back buttons climb one level at a time",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { click: "Open menu" },
      { click: "Open settings" },
      { click: "Open advanced settings" },
      { wait: 400 },
      { click: "Open Appearance settings" },
      { wait: 400 },
      { expectText: "Note lines" },
      { click: "Open fonts settings" },
      { wait: 400 },
      { expectSelector: '[aria-label="Import font"]' },
      { click: "Back" },
      { wait: 500 },
      { expectText: "Note lines" },
      { expectNoSelector: '[aria-label="Import font"]' },
      { click: "Back" },
      { wait: 500 },
      { expectSelector: '[aria-label="Open Privacy & security settings"]' },
      { expectNoText: "Note lines" },
      { click: "Back" },
      { wait: 500 },
      { expectText: "Smoke test note" },
      { expectNoSelector: '[aria-label="Open Appearance settings"]' },
    ],
  },
  // A settings page opened by address (no history behind it) still goes up one level.
  { name: "settings — Back from a page opened directly", path: "/settings/fonts", seed: SEED_ENTRIES, steps: [{ wait: 200 }, { expectSelector: '[aria-label="Import font"]' }, { click: "Back" }, { wait: 500 }, { expectText: "Note lines" }, { expectNoSelector: '[aria-label="Import font"]' }] },
  { name: "settings — unknown page", path: "/settings/nope", seed: SEED_ENTRIES, steps: [{ wait: 200 }, { expectText: "That settings page doesn't exist." }, { click: "Back" }, { wait: 500 }, { expectSelector: '[aria-label="Open Developer settings"]' }] },
  { name: "settings — privacy and developer pages", path: "/settings/privacy", seed: SEED_ENTRIES, steps: [{ wait: 200 }, { expectText: "App password" }, { expectText: "Not set yet" }, { click: "Back" }, { wait: 500 }, { click: "Open Developer settings" }, { wait: 400 }, { expectText: "Debug panel" }, { expectSelector: '[aria-label="Show debug panel"]' }] },
  // The Theme sheet's Back arrow returns to the Settings panel it was opened from; the panel's Back returns to the menu.
  {
    name: "settings — Back from the theme sheet and from the panel",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { click: "Open menu" },
      { click: "Open settings" },
      { click: "Open theme settings" },
      { wait: 300 },
      { expectText: "Landing page theme" },
      { expectNoSelector: '[aria-label="Open advanced settings"]' },
      { click: "Back" },
      { wait: 300 },
      { expectSelector: '[aria-label="Open advanced settings"]' },
      { expectNoText: "Landing page theme" },
      { click: "Back" },
      { wait: 300 },
      { expectSelector: '[aria-label="Open settings"]' },
      { expectNoSelector: '[aria-label="Open advanced settings"]' },
    ],
  },
  // Round 43: Trash gets a Back arrow (to the menu) and its own page in Advanced settings.
  {
    name: "trash — Back returns to the menu",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { click: "Open menu" },
      { clickSelector: ".menu-nav button:nth-child(1)" },
      { wait: 300 },
      { expectText: "Trash is empty." },
      { click: "Back" },
      { wait: 300 },
      { expectNoText: "Trash is empty." },
      { expectSelector: '[aria-label="Open settings"]' },
    ],
  },
  {
    name: "settings — Trash page",
    path: "/settings/trash",
    seed: SEED_ENTRIES,
    steps: [
      { wait: 200 },
      { expectText: "30 days" },
      { expectText: "Empty" },
      { click: "Open trash" },
      { wait: 300 },
      { expectText: "Trash is empty." },
      // the sheet's own Back (the page's Back is behind it)
      { clickSelector: ".sheet-header .back" },
      { wait: 300 },
      { expectNoText: "Trash is empty." },
      { expectSelector: '[aria-label="Open trash"]' },
      // still on the Trash page: the page's Back goes up to Advanced settings
      { click: "Back" },
      { wait: 500 },
      { expectSelector: '[aria-label="Open Trash settings"]' },
    ],
  },
  // Round 42: the seek slider. The long note is read as: title -> ALPHA -> BRAVO -> CHARLIE -> DELTA
  // (5 pieces; the slider's steps are 0..4). Dragging to 3 reads CHARLIE; while paused, moving the
  // slider makes no sound and Resume starts at the new place.
  {
    name: "note — read aloud seek slider",
    path: `/note/${LONG_NOTE_ID}`,
    seed: [...SEED_ENTRIES, LONG_NOTE],
    tts: true,
    steps: [
      { click: "More" },
      { click: "Read aloud" },
      { wait: 600 },
      { expectSelector: '[aria-label="Seek reading"]' },
      { expectText: "Reading… 1/5" },
      // Round 43: at the first piece the drawn slider is EMPTY (fraction 0), not already part-way along
      { expectSelector: '.seek-wrap[data-frac="0"]' },
      { expectSelector: ".seek-thumb" },
      { type: { label: "Seek reading", value: "3" } },
      { wait: 300 },
      { expectSelector: '.seek-wrap[data-frac="0.75"]' },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:CHARLIE", count: 1 } },
      { expectText: "Reading… 4/5" },
      { click: "Pause reading" },
      { wait: 150 },
      { type: { label: "Seek reading", value: "1" } },
      { wait: 200 },
      { expectText: "Paused 2/5" },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:ALPHA", count: 0 } },
      { click: "Resume reading" },
      { wait: 300 },
      { expectGlobalCount: { name: "__ttsCalls", substring: "speak:flush:default:1:ALPHA", count: 1 } },
      { expectText: "Reading… 2/5" },
    ],
  },
  // Round 33: landing-page list/grid. Default is list; Grid view switches
  // the container class, makes the note cards compact, persists, and the
  // todo/board cards follow (the Todos tab is clicked by selector — tabs
  // have no aria-label).
  {
    name: "home — list / grid view",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { expectSelector: ".grid.view-list" },
      { expectSelector: '[aria-label="List view"][aria-pressed="true"]' },
      { click: "Grid view" },
      { expectSelector: ".grid.view-grid" },
      { expectSelector: ".note-card.compact" },
      { expectSelector: '[aria-label="Grid view"][aria-pressed="true"]' },
      { expectStored: "grid" },
      { clickSelector: ".view-tabs button:nth-child(2)" },
      { expectSelector: ".grid.view-grid .todo-item.compact" },
      { click: "List view" },
      { expectSelector: ".grid.view-list" },
      { expectNotStored: "grid" },
    ],
  },
];

// steps (round 26): an ordered script of interactions, run after the
// initial settle (and after clickAriaLabel, if both are set). Each step is
// one of:
//   { click: "<aria-label>" }                          tap that element
//   { type: { label: "<aria-label>", value: "..." } }  set an input's value + fire `input`
//   { expectDownload: { ext, magic, minBytes } }        the last download's name ends with ext and its real bytes start with magic (round 30)
//   { expectGlobalIncludes: { name, substring } }       some entry of the recording array globalThis[name] contains substring (round 31)
//   { expectGlobalCount: { name, substring, count } }   exactly `count` entries contain it
//   { expectNoText: "..." }                             fail if the page text contains it
//   { expectStored: "..." } / { expectNotStored: "..." } search everything saved to localStorage (round 30)
//   { clickSelector: "<css>" }                         tap the first element matching a CSS selector (round 29)
//   { paste: "<text>" }                                fire a text/plain `paste` event at the editor (round 27)
//   { expectSelector: "<css>" }                        fail unless something matches
//   { expectText: "..." }                              fail unless the page text contains it
// with an optional { wait: ms } (default 250) after each one. Exists for
// flows that need MORE than one tap — the find & replace bar is behind
// More -> "Find and replace" — and to assert what the flow actually did
// to the page, not just that nothing threw. Like clickAriaLabel, this was
// added because "it mounts" has repeatedly not been enough (round 24).
function runScenario(scenario) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER], {
      env: {
        ...process.env,
        // Fixed zone: reminder times are asserted as exact UTC strings built
        // from local-time inputs, so the result can't depend on whose machine
        // runs this.
        TZ: "UTC",
        ...(scenario.reminderBackend ? { SMOKE_REMINDER_BACKEND: "fake" } : {}),
        ...(scenario.share ? { SMOKE_SHARE: scenario.share } : {}),
        ...(scenario.tts ? { SMOKE_TTS: scenario.tts === "noevents" ? "fake-noevents" : "fake" } : {}),
        SMOKE_BUILD_DIR: BUILD_DIR,
        SMOKE_ROUTE_PATH: scenario.path,
        SMOKE_SEED_ENTRIES: JSON.stringify(scenario.seed),
        ...(scenario.expectText ? { SMOKE_EXPECT_TEXT: scenario.expectText } : {}),
        ...(scenario.clickAriaLabel ? { SMOKE_CLICK_ARIA_LABEL: scenario.clickAriaLabel } : {}),
        ...(scenario.steps ? { SMOKE_STEPS: JSON.stringify(scenario.steps) } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code, output: output.trim() }));
  });
}

// Round 33: `SMOKE_ONLY=grid npm run smoke` runs just the scenarios whose name
// contains that text — for iterating on one feature, and for negative
// controls (break the feature, watch only its scenario fail) that would
// otherwise blow the 300 s command limit running everything.
const SELECTED = process.env.SMOKE_ONLY ? SCENARIOS.filter((sc) => sc.name.includes(process.env.SMOKE_ONLY)) : SCENARIOS;
if (SELECTED.length === 0) {
  console.error(`SMOKE_ONLY="${process.env.SMOKE_ONLY}" matched no scenario.`);
  process.exit(1);
}

console.log(`Smoke-testing ${SELECTED.length} scenario(s) against ${path.relative(REPO_ROOT, BUILD_DIR)}/\n`);

let anyFailed = false;
for (const scenario of SELECTED) {
  process.stdout.write(`  ${scenario.name.padEnd(22)} ${scenario.path.padEnd(28)} `);
  const { code, output } = await runScenario(scenario);
  if (code === 0) {
    console.log("PASS");
  } else {
    anyFailed = true;
    console.log("FAIL");
    if (output) {
      for (const line of output.split("\n").slice(0, 6)) console.log(`      ${line}`);
    }
  }
}

if (anyFailed) {
  console.error(
    "\nsmoke test failed — a route threw while mounting or settling.\n" +
      "Before touching any $effect or shared .svelte.ts store, read\n" +
      "docs/svelte5-effect-safety.md. This is almost always an effect\n" +
      "that reads and writes the same state, directly or through a\n" +
      "helper function it calls."
  );
  process.exit(1);
}

console.log("\nAll scenarios settled cleanly.");
