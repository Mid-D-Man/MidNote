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
  { name: "todo — comments", path: `/todo/${TODO_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Comments" }, { type: { label: "Add a comment", value: "todo remark zq3" } }, { wait: 200 }, { click: "Post comment" }, { expectText: "todo remark zq3" }, { expectStored: "todo remark zq3" }] },
  { name: "board — comments", path: `/board/${BOARD_ID}`, seed: SEED_ENTRIES, steps: [{ click: "More" }, { click: "Comments" }, { type: { label: "Add a comment", value: "board remark zq4" } }, { wait: 200 }, { click: "Post comment" }, { expectText: "board remark zq4" }, { expectStored: "board remark zq4" }] },
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
  // Round 33: Settings -> Fonts. The sheet opens from the Settings list, the
  // default note font can be chosen, and the choice reaches localStorage
  // (the note editor reads it from there on its next load).
  {
    name: "settings — fonts + default font",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { click: "Open menu" },
      { click: "Open settings" },
      { click: "Open fonts settings" },
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
