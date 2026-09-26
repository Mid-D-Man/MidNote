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
];

function runScenario(scenario) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER], {
      env: {
        ...process.env,
        SMOKE_BUILD_DIR: BUILD_DIR,
        SMOKE_ROUTE_PATH: scenario.path,
        SMOKE_SEED_ENTRIES: JSON.stringify(scenario.seed),
        ...(scenario.expectText ? { SMOKE_EXPECT_TEXT: scenario.expectText } : {}),
        ...(scenario.clickAriaLabel ? { SMOKE_CLICK_ARIA_LABEL: scenario.clickAriaLabel } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code, output: output.trim() }));
  });
}

console.log(`Smoke-testing ${SCENARIOS.length} scenario(s) against ${path.relative(REPO_ROOT, BUILD_DIR)}/\n`);

let anyFailed = false;
for (const scenario of SCENARIOS) {
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
