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

// Round 45: the backup file the restore scenario picks. The note is the seeded one with an OLD
// timestamp (the phone's copy is newer -> kept), the todo is the seeded one with a FAR-FUTURE
// timestamp and a new title (the file's copy is newer -> updated), the second note is new (added).
// A theme and a font (a 4-byte TrueType header is enough for the app's own font check) come along.
const RESTORE_BACKUP = {
  app: "midnote-backup",
  format: 1,
  createdAt: "2026-10-01T10:00:00.000Z",
  entries: [
    { ...SEED_ENTRIES.find((e) => e.id === NOTE_ID), lastModified: "2000-01-01T00:00:00.000Z" },
    { ...SEED_ENTRIES.find((e) => e.id === TODO_ID), title: "Todo from the future", lastModified: "2999-01-01T00:00:00.000Z" },
    { ...SEED_ENTRIES.find((e) => e.id === NOTE_ID), id: "smoke-test-note-restored", title: "Restored note from backup", content: "<p>back from the file</p>", lastModified: "2026-09-01T00:00:00.000Z" },
  ],
  tags: { notes: ["restored-tag"], todos: [], boards: [] },
  themes: [{ id: "theme-restored", name: "Restored", data: "data:image/png;base64,AAAA", createdAt: "2026-09-01T00:00:00.000Z" }],
  icons: [],
  fonts: [{ id: "font-restored", name: "Restored Font", kind: "ttf", size: 8, addedAt: "2026-09-01T00:00:00.000Z", data: "AAEAAAAAAAA=" }],
  settings: { "midnote:note-lines": "true" },
};
// the old (format 1) file: plain JSON, still readable
const RESTORE_BACKUP_TEXT = JSON.stringify(RESTORE_BACKUP);

// Round E: the same backup as a format 2 .mdix file. A deliberately tiny writer for FIXTURES (the app's own
// writer is utils/backupMdix.ts; its output is checked against the real DixScript parser in the logic tests).
const mdixLit = (v) =>
  v === null || v === undefined ? "null"
  : Array.isArray(v) ? `[${v.map(mdixLit).join(", ")}]`
  : typeof v === "object" ? `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k} = ${mdixLit(x)}`).join(", ")} }`
  : JSON.stringify(v);
const group = (name, items) => (items.length ? `  ${name}::\n${items.map((i) => `    ${mdixLit(i)}`).join(",\n")}\n` : "");
const RESTORE_BACKUP_MDIX =
  `// Brought to u by MidManStudio\n\n@CONFIG(\n  version    -> "1.0.0"\n  features   -> "data"\n  debug_mode -> "off"\n)\n\n@DATA(\n` +
  `  app = "midnote-backup"\n  format = 2\n  createdAt = "${RESTORE_BACKUP.createdAt}"\n  tags = ${mdixLit(RESTORE_BACKUP.tags)}\n` +
  group("entries", RESTORE_BACKUP.entries) + group("themes", RESTORE_BACKUP.themes) + group("fonts", RESTORE_BACKUP.fonts) +
  group("settings", Object.entries(RESTORE_BACKUP.settings).map(([key, value]) => ({ key, value }))) + ")\n";

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

// Round 47: small seeds for the folder scenarios.
const FOLDER_TAB = ".view-tabs button:nth-child(4)";
const smokeFolder = (id, title, parentId = null, tags = []) => ({ id, type: "folder", title, tags, lastModified: now, parentId });
const smokeNote = (id, title, parentId = null, tags = []) => ({ id, type: "regular", title, content: "x", tags, lastModified: now, isBookmarked: false, encrypted: false, parentId });

// Round B: seeds and helpers for the account scenarios (declared before SCENARIOS because it calls accountScenarios()).
// A person who signed in on an earlier run: the session MidNote keeps on the phone.
const SEED_UID = "22222222-2222-4222-8222-222222222222";
const sessionJson = (expiresAt) =>
  JSON.stringify({ accessToken: "AT-seed", refreshToken: "RT-seed", expiresAt, user: { id: SEED_UID, email: "seed@verified.test" } });
const SESSION_EXPIRED = sessionJson(1);
const SESSION_VALID = sessionJson(4102444800000);
const COLD_VERIFIER = "cold-start-verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFGH";
const SEED_USER = { email: "seed@verified.test", password: "seed-password", id: SEED_UID };
const SUBMIT = 'form button[type="submit"]';
const SIGNUP_TAB = ".tabs button:nth-child(2)";
const A_USER = { email: "a@verified.test", password: "correct-horse" };
const fillSignIn = (email, password) => [
  { type: { label: "Email", value: email } },
  { type: { label: "Password", value: password } },
  { clickSelector: SUBMIT },
  { wait: 400 },
];

function accountScenarios() {
  return [
    {
      name: "account — no online settings in the build: the dialog says so, plainly",
      path: "/",
      seed: [],
      steps: [{ click: "Open menu" }, { click: "Open login" }, { expectText: "Online features" }, { expectText: "isn't connected to an account service" }, { expectNoSelector: 'input[aria-label="Email"]' }],
    },
    { name: "account — Settings → Account without online settings", path: "/settings/account", seed: [], steps: [{ expectText: "Online features aren't available in this build" }] },
    { name: "account — the settings hub lists Account", path: "/settings", seed: [], steps: [{ expectText: "Account" }, { expectText: "Sign in to use sync and AI" }] },
    {
      name: "account — a secret key in the build is refused, not used",
      path: "/",
      seed: [],
      online: { config: { url: "https://smoke.supabase.co", key: "sb_secret_oops" } },
      steps: [{ click: "Open menu" }, { click: "Open login" }, { expectText: "secret key" }, { expectNoSelector: 'input[aria-label="Email"]' }, { expectGlobalCount: { name: "__onlineCalls", substring: "/", count: 0 } }],
    },
    {
      name: "account — wrong password: a plain message, nothing saved",
      path: "/",
      seed: [],
      online: { users: [A_USER] },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        ...fillSignIn(A_USER.email, "not-the-password"),
        { expectText: "That email and password don't match" },
        { expectNotStored: "FAKEAT-" },
        { expectSelector: 'input[aria-label="Password"]' },
      ],
    },
    {
      name: "account — sign in: session saved, menu switches to Account, MidNote enrolled",
      path: "/",
      seed: [],
      online: { users: [A_USER] },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        ...fillSignIn(A_USER.email, A_USER.password),
        { expectStored: "FAKEAT-" },
        { expectNoSelector: 'input[aria-label="Email"]' },
        { wait: 400 },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /rest/v1/service_subscriptions" } },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: '"service_id":"svc-1"' } },
        { click: "Open menu" },
        { expectSelector: '[aria-label="Open account"]' },
        { expectNoSelector: '[aria-label="Open login"]' },
        { expectNoSelector: '[aria-label="Open sign up"]' },
      ],
    },
    {
      name: "account — the studio refusing the enrolment never blocks sign-in",
      path: "/",
      seed: [],
      online: { users: [A_USER], enrolPost: 403 },
      steps: [{ click: "Open menu" }, { click: "Open login" }, ...fillSignIn(A_USER.email, A_USER.password), { wait: 400 }, { expectStored: "FAKEAT-" }, { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /rest/v1/service_subscriptions" } }],
    },
    {
      name: "account — sign up asks to confirm the email; after confirming, sign in works",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [], confirmOnResend: true },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { type: { label: "Name", value: "  Ada Lovelace " } },
        { type: { label: "Email", value: "New.Person@verified.test" } },
        { type: { label: "Password", value: "A-fine-password-1" } },
        { type: { label: "Confirm password", value: "A-fine-password-1" } },
        { clickSelector: SUBMIT },
        { wait: 400 },
        { expectText: "Check your email" },
        { expectText: "New.Person@verified.test" },
        { expectNotStored: "FAKEAT-" },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /auth/v1/signup display_name=Ada Lovelace" } },
        { click: "Resend email" },
        { wait: 300 },
        { expectText: "Sent again" },
        { click: "Go to sign in" },
        { type: { label: "Password", value: "A-fine-password-1" } },
        { clickSelector: SUBMIT },
        { wait: 400 },
        { expectStored: "FAKEAT-" },
        { expectStored: "new.person@verified.test" },
      ],
    },
    {
      name: "account — the Name field is on Create account only",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { expectNoSelector: 'input[aria-label="Name"]' },
        { clickSelector: SIGNUP_TAB },
        { expectSelector: 'input[aria-label="Name"]' },
        { expectText: "At least 8 characters" },
      ],
    },
    {
      name: "account — signing in before confirming offers a resend",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [{ email: "late@verified.test", password: "pw-pw-pw", confirmed: false }] },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        ...fillSignIn("late@verified.test", "pw-pw-pw"),
        { expectText: "Confirm your email first" },
        { expectSelector: '[aria-label="Resend confirmation email"]' },
        { expectNotStored: "FAKEAT-" },
      ],
    },
    {
      name: "account — a 7-character password is refused before anything is sent (the studio minimum is 8)",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { type: { label: "Name", value: "Short Pw" } },
        { type: { label: "Email", value: "short@verified.test" } },
        { type: { label: "Password", value: "1234567" } },
        { type: { label: "Confirm password", value: "1234567" } },
        { clickSelector: SUBMIT },
        { wait: 300 },
        { expectText: "too weak" },
        { expectGlobalCount: { name: "__onlineCalls", substring: "/auth/v1/signup", count: 0 } },
      ],
    },
    {
      name: "account — the server failing a sign-up: a plain message, the form usable again, the reason in the debug log",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [], signupFail: { status: 500, body: { code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" } } },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { type: { label: "Name", value: "Trouble" } },
        { type: { label: "Email", value: "trouble@verified.test" } },
        { type: { label: "Password", value: "A-fine-password-1" } },
        { type: { label: "Confirm password", value: "A-fine-password-1" } },
        { clickSelector: SUBMIT },
        { wait: 400 },
        { expectText: "The server had a problem" },
        { expectNoText: "Please wait" },
        { click: "Debug panel" },
        { expectText: "account: sign-up failed (server 500: Database error saving new user)" },
        { expectNotStored: "FAKEAT-" },
      ],
    },
    {
      name: "account — forgot password stays neutral",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { click: "Forgot password" },
        { type: { label: "Email", value: "nobody@verified.test" } },
        { clickSelector: SUBMIT },
        { wait: 300 },
        { expectText: "a reset link is on its way" },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /auth/v1/recover?redirect_to=https%3A%2F%2Fmms-accounts.pages.dev" } },
        { click: "Back to sign in" },
        { expectSelector: 'input[aria-label="Password"]' },
      ],
    },
    {
      name: "account — no signal: signing in says so, and stays signed out",
      path: "/",
      seed: [],
      online: { users: [A_USER], offline: true },
      steps: [{ click: "Open menu" }, { click: "Open login" }, ...fillSignIn(A_USER.email, A_USER.password), { expectText: "Can't reach the server" }, { expectNotStored: "FAKEAT-" }],
    },
    {
      name: "account — a saved session is picked up at startup",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [{ expectText: "seed@verified.test" }, { expectSelector: '[aria-label="Sign out"]' }, { expectNoSelector: '[aria-label="Create an account"]' }],
    },
    {
      name: "account — an expired token is refreshed quietly at startup (and the new tokens saved)",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_EXPIRED },
      online: { users: [SEED_USER], knownRefreshTokens: [{ token: "RT-seed", email: SEED_USER.email }] },
      steps: [{ wait: 600 }, { expectText: "seed@verified.test" }, { expectStored: "FAKEAT-" }, { expectNotStored: "RT-seed" }, { expectGlobalCount: { name: "__onlineCalls", substring: "grant_type=refresh_token", count: 1 } }],
    },
    {
      name: "account — no signal at startup with an old token: still signed in, session kept",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_EXPIRED },
      online: { users: [SEED_USER], offline: true },
      steps: [{ wait: 600 }, { expectText: "seed@verified.test" }, { expectStored: "RT-seed" }, { expectSelector: '[aria-label="Sign out"]' }],
    },
    {
      name: "account — a session the server has ended signs you out",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_EXPIRED },
      online: { users: [SEED_USER], refreshStatus: 400 },
      steps: [{ wait: 600 }, { expectText: "You're not signed in" }, { expectNotStored: "RT-seed" }, { expectNotStored: "AT-seed" }],
    },
    {
      name: "account — sign out: ends the session here, tells the server, notes stay",
      path: "/settings/account",
      seed: SEED_ENTRIES,
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [
        { click: "Sign out" },
        { wait: 400 },
        { expectText: "You're not signed in" },
        { expectNotStored: "AT-seed" },
        { expectNotStored: "RT-seed" },
        { expectStored: "Smoke test note" },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /auth/v1/logout?scope=local" } },
        { expectSelector: '[aria-label="Sign in"]' },
      ],
    },
    // ---- password without email (signed in) + the portal link
    {
      name: "account — set a password in the app: the rules and the confirm apply, then it is saved (no email)",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [
        { expectNoSelector: 'input[aria-label="New password"]' },
        { click: "Set or change password" },
        { type: { label: "New password", value: "alllower1" } },
        { type: { label: "Confirm new password", value: "alllower1" } },
        { click: "Save password" },
        { expectText: "with a capital letter and a number" },
        { type: { label: "New password", value: "Abcdefg1" } },
        { type: { label: "Confirm new password", value: "Abcdefg2" } },
        { click: "Save password" },
        { expectText: "The two passwords don't match" },
        { expectGlobalCount: { name: "__onlineCalls", substring: "PUT /auth/v1/user", count: 0 } },
        { type: { label: "Confirm new password", value: "Abcdefg1" } },
        { click: "Save password" },
        { wait: 400 },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "PUT /auth/v1/user" } },
        { expectGlobalCount: { name: "__onlineCalls", substring: "/auth/v1/recover", count: 0 } },
        { expectNoSelector: 'input[aria-label="New password"]' },
        { expectText: "Password saved" },
      ],
    },
    {
      name: "account — the live rules show under the new-password fields",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [
        { click: "Set or change password" },
        { expectNoSelector: ".rules li.met" },
        { type: { label: "New password", value: "Abcdefg1" } },
        { expectSelector: ".rules li:nth-child(1).met" },
        { expectSelector: ".rules li:nth-child(2).met" },
        { expectSelector: ".rules li:nth-child(3).met" },
        { expectNoSelector: ".rules li:nth-child(4).met" },
        { type: { label: "Confirm new password", value: "Abcdefg1" } },
        { expectSelector: ".rules li:nth-child(4).met" },
      ],
    },
    {
      name: "account — choosing the same password again: a plain message",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"], passwordChange: "same" },
      steps: [{ click: "Set or change password" }, { type: { label: "New password", value: "Abcdefg1" } }, { type: { label: "Confirm new password", value: "Abcdefg1" } }, { click: "Save password" }, { wait: 300 }, { expectText: "already your password" }, { expectSelector: 'input[aria-label="New password"]' }],
    },
    {
      name: "account — the server asking for a fresh sign-in before a password change: a plain message",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"], passwordChange: "reauth" },
      steps: [{ click: "Set or change password" }, { type: { label: "New password", value: "Abcdefg1" } }, { type: { label: "Confirm new password", value: "Abcdefg1" } }, { click: "Save password" }, { wait: 300 }, { expectText: "sign out and sign in again" }],
    },
    {
      name: "account — the server finding the password too weak: a plain message, form stays open",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"], passwordChange: "weak" },
      steps: [{ click: "Set or change password" }, { type: { label: "New password", value: "Abcdefg1" } }, { type: { label: "Confirm new password", value: "Abcdefg1" } }, { click: "Save password" }, { wait: 300 }, { expectText: "too weak" }, { expectSelector: 'input[aria-label="New password"]' }],
    },
    {
      name: "account — Manage on MidManStudio opens the accounts page in the browser",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [{ click: "Manage on MidManStudio" }, { wait: 200 }, { expectGlobalIncludes: { name: "__onlineCalls", substring: "OPEN https://mms-accounts.pages.dev" } }],
    },

    // ---- the email-dependent flows are hidden unless the build switches them on
    {
      name: "account — email flows hidden by default: no Create account tab, no Forgot password, no Sign Up entry",
      path: "/",
      seed: [],
      online: { users: [] },
      steps: [
        { click: "Open menu" },
        { expectSelector: '[aria-label="Open login"]' },
        { expectNoSelector: '[aria-label="Open sign up"]' },
        { click: "Open login" },
        { expectSelector: '[aria-label="Continue with Google"]' },
        { expectSelector: 'input[aria-label="Email"]' },
        { expectNoSelector: ".tabs" },
        { expectNoSelector: '[aria-label="Forgot password"]' },
        { expectText: "Google creates your account" },
      ],
    },
    {
      name: "account — email flows hidden by default: Settings → Account offers Sign in only",
      path: "/settings/account",
      seed: [],
      online: { users: [] },
      steps: [{ expectSelector: '[aria-label="Sign in"]' }, { expectNoSelector: '[aria-label="Create an account"]' }, { click: "Sign in" }, { expectNoSelector: ".tabs" }, { expectSelector: '[aria-label="Continue with Google"]' }],
    },
    {
      name: "account — email flows switched on: Sign Up entry, tabs and Forgot password are back",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { expectSelector: '[aria-label="Open sign up"]' },
        { click: "Open login" },
        { expectSelector: ".tabs" },
        { expectSelector: '[aria-label="Forgot password"]' },
        { expectNoText: "Google creates your account" },
      ],
    },
    {
      name: "account — email flows switched on: Settings → Account offers Create an account too",
      path: "/settings/account",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [{ expectSelector: '[aria-label="Create an account"]' }],
    },
    {
      name: "account — enrolment runs once, and not again for a person it already worked for",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID, "midnote:enrolled-user": SEED_UID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [{ wait: 500 }, { expectText: "seed@verified.test" }, { expectGlobalCount: { name: "__onlineCalls", substring: "/rest/v1/services", count: 0 } }],
    },
    {
      name: "account — a signed-in person with no enrolment record gets enrolled at startup",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:session": SESSION_VALID },
      online: { users: [SEED_USER], validAccess: ["AT-seed"] },
      steps: [{ wait: 500 }, { expectGlobalCount: { name: "__onlineCalls", substring: "/rest/v1/services", count: 1 } }, { expectGlobalIncludes: { name: "__onlineCalls", substring: `"user_id":"${SEED_UID}"` } }],
    },
    {
      name: "account — the cloud button signed out opens sign-in; signed in it is honest about sync",
      path: "/",
      seed: [],
      online: { users: [A_USER] },
      steps: [
        { click: "Cloud sync" },
        { expectSelector: 'input[aria-label="Email"]' },
        ...fillSignIn(A_USER.email, A_USER.password),
        { click: "Cloud sync" },
        { expectText: "Sync isn't built yet" },
      ],
    },

    // ---- password rules + confirm
    {
      name: "account — the passwords must match; nothing is sent when they don't",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { type: { label: "Name", value: "Mismatch" } },
        { type: { label: "Email", value: "mismatch@verified.test" } },
        { type: { label: "Password", value: "Abcdefg1" } },
        { type: { label: "Confirm password", value: "Abcdefg2" } },
        { clickSelector: SUBMIT },
        { wait: 300 },
        { expectText: "The two passwords don't match" },
        { expectGlobalCount: { name: "__onlineCalls", substring: "/auth/v1/signup", count: 0 } },
      ],
    },
    {
      name: "account — no capital letter / no number: refused with the rules, nothing is sent",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { type: { label: "Name", value: "Weak" } },
        { type: { label: "Email", value: "weak@verified.test" } },
        { type: { label: "Password", value: "alllowercase1" } },
        { type: { label: "Confirm password", value: "alllowercase1" } },
        { clickSelector: SUBMIT },
        { wait: 300 },
        { expectText: "with a capital letter and a number" },
        { type: { label: "Password", value: "NoNumbersHere" } },
        { type: { label: "Confirm password", value: "NoNumbersHere" } },
        { clickSelector: SUBMIT },
        { wait: 300 },
        { expectText: "with a capital letter and a number" },
        { expectGlobalCount: { name: "__onlineCalls", substring: "/auth/v1/signup", count: 0 } },
      ],
    },
    {
      name: "account — the password rules tick off live as you type",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { expectNoSelector: ".rules li.met" },
        { type: { label: "Password", value: "abc" } },
        { expectNoSelector: ".rules li.met" },
        { type: { label: "Password", value: "abcdefghi" } },
        { expectSelector: ".rules li:nth-child(1).met" },
        { expectNoSelector: ".rules li:nth-child(2).met" },
        { type: { label: "Password", value: "Abcdefghi" } },
        { expectSelector: ".rules li:nth-child(2).met" },
        { expectNoSelector: ".rules li:nth-child(3).met" },
        { type: { label: "Password", value: "Abcdefgh1" } },
        { expectSelector: ".rules li:nth-child(3).met" },
        { expectNoSelector: ".rules li:nth-child(4).met" },
        { type: { label: "Confirm password", value: "Abcdefgh1" } },
        { expectSelector: ".rules li:nth-child(4).met" },
        { type: { label: "Confirm password", value: "Abcdefgh2" } },
        { expectNoSelector: ".rules li:nth-child(4).met" },
      ],
    },
    {
      name: "account — signing in has no password rules and no confirm field",
      path: "/",
      seed: [],
      online: { users: [{ email: "old@verified.test", password: "simple" }] },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { expectNoSelector: 'input[aria-label="Confirm password"]' },
        { expectNoSelector: ".rules" },
        ...fillSignIn("old@verified.test", "simple"),
        { expectStored: "FAKEAT-" },
      ],
    },

    // ---- Continue with Google (browser out, midnote://auth back, PKCE checked by the fake server)
    {
      name: "account — Continue with Google: the browser opens, the link brings you back signed in",
      path: "/",
      seed: [],
      online: { users: [], google: "ok" },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { click: "Continue with Google" },
        { wait: 700 },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "OPEN https://smoke.supabase.co/auth/v1/authorize provider=google method=s256 redirect=midnote://auth" } },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /auth/v1/token?grant_type=pkce" } },
        { expectStored: "FAKEAT-" },
        { expectStored: "gina@gmail.test" },
        { expectText: "gina@gmail.test" },
        { expectNoSelector: 'input[aria-label="Email"]' },
        { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /rest/v1/service_subscriptions" } },
      ],
    },
    {
      name: "account — Google is offered on both Sign in and Create account",
      path: "/",
      seed: [],
      online: { emailFlows: true, users: [] },
      steps: [
        { click: "Open menu" },
        { click: "Open sign up" },
        { expectSelector: '[aria-label="Continue with Google"]' },
        { clickSelector: ".tabs button:nth-child(1)" },
        { expectSelector: '[aria-label="Continue with Google"]' },
        { click: "Forgot password" },
        { expectNoSelector: '[aria-label="Continue with Google"]' },
      ],
    },
    {
      name: "account — the same Google link delivered twice signs in once",
      path: "/",
      seed: [],
      online: { users: [], google: "dupe" },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { click: "Continue with Google" },
        { wait: 800 },
        { expectStored: "gina@gmail.test" },
        { expectGlobalCount: { name: "__onlineCalls", substring: "grant_type=pkce", count: 1 } },
        { expectNoText: "Google sign-in didn't finish" },
      ],
    },
    {
      name: "account — cancelling in Google: a plain message, still signed out, button back",
      path: "/",
      seed: [],
      online: { users: [], google: "denied" },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { click: "Continue with Google" },
        { wait: 700 },
        { expectText: "Google sign-in was cancelled" },
        { expectSelector: '.dialog .err[role="alert"]' },
        { expectNotStored: "FAKEAT-" },
        { expectSelector: '[aria-label="Continue with Google"]' },
        { expectGlobalCount: { name: "__onlineCalls", substring: "grant_type=pkce", count: 0 } },
      ],
    },
    {
      name: "account — Google failing on the server side: a plain message",
      path: "/",
      seed: [],
      online: { users: [], google: "error" },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { click: "Continue with Google" },
        { wait: 700 },
        { expectText: "Google sign-in didn't finish" },
        { expectSelector: '.dialog .err[role="alert"]' },
        { expectNotStored: "FAKEAT-" },
      ],
    },
    {
      name: "account — the browser never comes back: waiting message, Cancel gives the button back",
      path: "/",
      seed: [],
      online: { users: [], google: "never" },
      steps: [
        { click: "Open menu" },
        { click: "Open login" },
        { click: "Continue with Google" },
        { wait: 400 },
        { expectText: "Finish signing in with Google in your browser" },
        { expectNoSelector: '[aria-label="Continue with Google"]' },
        { click: "Cancel Google sign-in" },
        { expectSelector: '[aria-label="Continue with Google"]' },
        { expectNoText: "Finish signing in with Google" },
      ],
    },
    {
      name: "account — Android closed the app during Google sign-in: opened by the returning link, it finishes",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:oauth-pending": JSON.stringify({ verifier: COLD_VERIFIER, at: "__NOW__" }) },
      online: { users: [], coldStart: { verifier: COLD_VERIFIER } },
      steps: [{ wait: 700 }, { expectText: "gina@gmail.test" }, { expectStored: "FAKEAT-" }, { expectNotStored: COLD_VERIFIER }, { expectGlobalCount: { name: "__onlineCalls", substring: "grant_type=pkce", count: 1 } }],
    },
    {
      name: "account — a Google sign-in left waiting too long (over 10 minutes) is refused, with a plain message",
      path: "/settings/account",
      seed: [],
      storage: { "midnote:oauth-pending": JSON.stringify({ verifier: COLD_VERIFIER, at: 1 }) },
      online: { users: [], coldStart: { verifier: COLD_VERIFIER } },
      steps: [{ wait: 700 }, { expectText: "You're not signed in" }, { expectText: "Google sign-in didn't finish" }, { expectNotStored: "FAKEAT-" }, { expectGlobalCount: { name: "__onlineCalls", substring: "grant_type=pkce", count: 0 } }],
    },
    {
      name: "account — a midnote link nobody asked for is ignored",
      path: "/settings/account",
      seed: [],
      online: { users: [], strayLink: true },
      steps: [{ wait: 600 }, { expectText: "You're not signed in" }, { expectGlobalCount: { name: "__onlineCalls", substring: "grant_type=pkce", count: 0 } }, { expectNotStored: "FAKEAT-" }],
    },
    {
      name: "account — Google with no online settings in the build: no button, no crash",
      path: "/",
      seed: [],
      steps: [{ click: "Open menu" }, { click: "Open login" }, { expectText: "Online features" }, { expectNoSelector: '[aria-label="Continue with Google"]' }],
    },
  ];
}

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
  // Round D2: Settings -> AI (credits, availability, a try-it box). The AI server is a fake inside the smoke worker
  // (scenario.online.ai); every call it gets is recorded in __aiCalls as "METHOD /path auth=user|bad|none <body>".
  {
    name: "settings hub — lists the AI category",
    path: "/settings",
    seed: [],
    steps: [{ wait: 200 }, { expectText: "Your AI credits, and a box to try it." }],
  },
  {
    name: "ai — a build with no AI address says so (and offers no sign-in)",
    path: "/settings/ai",
    seed: [],
    steps: [{ wait: 200 }, { expectText: "AI isn't set up in this build." }, { expectNoSelector: '[aria-label="Sign in to use AI"]' }, { expectNoSelector: '[aria-label="Ask AI"]' }],
  },
  {
    name: "ai — signed out asks for a sign-in and sends nothing",
    path: "/settings/ai",
    seed: [],
    online: { users: [SEED_USER], ai: { url: "https://ai.smoke.test" } },
    steps: [
      { wait: 300 },
      { expectText: "Sign in to use AI." },
      { expectNoSelector: '[aria-label="Ask AI"]' },
      { click: "Sign in to use AI" },
      { wait: 300 },
      { expectSelector: ".dialog" },
      { expectGlobalCount: { name: "__aiCalls", substring: "/v1/ai/", count: 0 } },
    ],
  },
  {
    name: "ai — signed in: credits, today's allowance and availability (the person's own token is sent)",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test" } },
    steps: [
      { wait: 600 },
      { expectText: "Your AI credits" },
      { expectText: "2,996" },
      { expectText: "credits left" },
      { expectText: "Left today: 396 of 400" },
      { expectText: "Next top-up:" },
      { expectText: "AI is available." },
      { expectNoText: "Sign in to use AI." },
      { expectGlobalCount: { name: "__aiCalls", substring: "GET /v1/ai/status auth=user", count: 1 } },
      { expectGlobalCount: { name: "__aiCalls", substring: "auth=bad", count: 0 } },
    ],
  },
  {
    name: "ai — the shared free capacity is used up: says when it comes back",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", status: { enabled: true, has_account: true, balance: 500, daily_cap: 400, daily_left: 100, next_topup_at: null, pool_open: false, resets_in: 10800 } } },
    steps: [{ wait: 600 }, { expectText: "AI is resting" }, { expectText: "about 3 hours" }, { expectNoText: "AI is available." }, { expectNoText: "Next top-up:" }],
  },
  {
    name: "ai — switched off by the owner",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", status: { enabled: false, has_account: true, balance: 10, daily_cap: 400, daily_left: 400, next_topup_at: null, pool_open: false, resets_in: 100 } } },
    steps: [{ wait: 600 }, { expectText: "AI is switched off right now." }, { expectNoText: "AI is resting" }],
  },
  {
    name: "ai — a new person sees the credits they will start with",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", status: { enabled: true, has_account: false, balance: 3000, daily_cap: 400, daily_left: 400, next_topup_at: null, pool_open: true, resets_in: 100 } } },
    steps: [{ wait: 600 }, { expectText: "3,000" }, { expectText: "credits to start" }, { expectText: "added the first time you use AI" }],
  },
  {
    name: "ai — write a note: the answer is shown, not stored, and the numbers update",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", run: { status: 200, body: { text: "Packing list: socks, charger, book.", model: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", credits_charged: 4, balance: 2992 } } } },
    steps: [
      { wait: 600 },
      { expectSelector: '[aria-label="Ask AI"][disabled]' },
      { type: { label: "What should the AI write?", value: "SMOKE-PROMPT-1 a packing list" } },
      { wait: 100 },
      { expectNoSelector: '[aria-label="Ask AI"][disabled]' },
      { click: "Ask AI" },
      { wait: 400 },
      { expectText: "Packing list: socks, charger, book." },
      { expectText: "Nothing is saved or changed." },
      { expectText: "Used 4 credits · 2,992 left" },
      // the credit numbers above follow the answer without another round trip
      { expectText: "Left today: 392 of 400" },
      { expectText: "2,992 credits left" },
      { expectGlobalIncludes: { name: "__aiCalls", substring: 'POST /v1/ai/run auth=user {"task":"create","prompt":"SMOKE-PROMPT-1 a packing list"}' } },
      { expectGlobalCount: { name: "__aiCalls", substring: "POST /v1/ai/run", count: 1 } },
      { expectNotStored: "Packing list: socks" },
      { expectNotStored: "SMOKE-PROMPT-1" },
    ],
  },
  {
    name: "ai — edit text: instruction and text go together",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", run: { status: 200, body: { text: "Short version.", model: "m", credits_charged: 1, balance: 2995 } } } },
    steps: [
      { wait: 600 },
      { click: "Edit text" },
      { wait: 100 },
      { expectSelector: '[aria-label="Text to change"]' },
      { expectNoSelector: '[aria-label="What should the AI write?"]' },
      { type: { label: "What should the AI do with the text?", value: "Make it shorter" } },
      { expectSelector: '[aria-label="Ask AI"][disabled]' },
      { type: { label: "Text to change", value: "A very long and winding text." } },
      { wait: 100 },
      { click: "Ask AI" },
      { wait: 400 },
      { expectText: "Short version." },
      { expectText: "Used 1 credit · 2,995 left" },
      { expectGlobalIncludes: { name: "__aiCalls", substring: 'POST /v1/ai/run auth=user {"task":"transform","instruction":"Make it shorter","text":"A very long and winding text."}' } },
    ],
  },
  {
    name: "ai — Copy puts the answer on the clipboard, Clear removes it",
    path: "/settings/ai",
    seed: [],
    copy: true,
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", run: { status: 200, body: { text: "Copy me please.", model: "m", credits_charged: 2, balance: 2994 } } } },
    steps: [
      { wait: 600 },
      { type: { label: "What should the AI write?", value: "anything" } },
      { click: "Ask AI" },
      { wait: 400 },
      { click: "Copy AI answer" },
      { wait: 200 },
      { expectGlobalIncludes: { name: "__copied", substring: "Copy me please." } },
      { expectText: "Copied" },
      { click: "Clear AI answer" },
      { wait: 100 },
      { expectNoText: "Copy me please." },
      { expectNoSelector: '[aria-label="Copy AI answer"]' },
    ],
  },
  {
    name: "ai — every failure is explained in plain words, and the numbers are reloaded",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: {
      users: [SEED_USER],
      validAccess: ["AT-seed"],
      ai: {
        url: "https://ai.smoke.test",
        runs: [
          { status: 402, body: { error: "no-credits", message: "x", balance: 0 } },
          { status: 429, body: { error: "daily-cap", message: "x" } },
          { status: 503, body: { error: "pool-exhausted", message: "x", retry_after: 10800 } },
          { status: 413, body: { error: "too-long", message: "x" } },
          { status: 504, body: { error: "timeout", message: "x" } },
          { status: 502, body: { error: "ai-failed", message: "x" } },
          { status: 429, body: { error: "busy", message: "x" } },
          { status: 429, body: { error: "rate-limited", message: "x" } },
          { status: 502, body: { error: "empty-response", message: "x" } },
          { status: 500, body: "boom" },
        ],
      },
    },
    steps: [
      { wait: 600 },
      { type: { label: "What should the AI write?", value: "anything" } },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "You're out of AI credits." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "You've used today's AI allowance." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "AI is resting: today's free capacity is used up. It's back in about 3 hours." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "That's too long for AI." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "The AI took too long. You weren't charged." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "The AI didn't answer. You weren't charged." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "Another AI request is still running." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "Try again in a minute." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "The AI returned nothing." },
      { click: "Ask AI" }, { wait: 300 }, { expectText: "Something went wrong on the AI server." },
      // no-credits, daily-cap, pool-exhausted and busy each reloaded the numbers quietly (1 on open + 4)
      { expectGlobalCount: { name: "__aiCalls", substring: "GET /v1/ai/status", count: 5 } },
    ],
  },
  {
    name: "ai — an expired token is refreshed once and the call carries on",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], knownRefreshTokens: [{ token: "RT-seed", email: SEED_USER.email }], ai: { url: "https://ai.smoke.test", rejectFirst: true } },
    steps: [
      { wait: 800 },
      { expectText: "2,996" },
      { expectText: "AI is available." },
      { expectGlobalCount: { name: "__aiCalls", substring: "GET /v1/ai/status", count: 2 } },
      { expectGlobalIncludes: { name: "__onlineCalls", substring: "POST /auth/v1/token?grant_type=refresh_token" } },
    ],
  },
  {
    name: "ai — no connection: says so, on the credits and on a question",
    path: "/settings/ai",
    seed: [],
    storage: { "midnote:session": SESSION_VALID },
    online: { users: [SEED_USER], validAccess: ["AT-seed"], ai: { url: "https://ai.smoke.test", offline: true } },
    steps: [
      { wait: 600 },
      { expectText: "Can't reach the AI server. Check your connection and try again." },
      { type: { label: "What should the AI write?", value: "anything" } },
      { click: "Ask AI" },
      { wait: 300 },
      { expectSelector: '[aria-label="AI credits"] .notice.error' },
      { expectSelector: '[aria-label="Try AI"] .notice.error' },
    ],
  },
  // Round 45 (format 1) / Round E (format 2, .mdix): Backup & restore.
  {
    name: "settings — backup: Back up everything saves one plain .mdix file",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    storage: { "midnote:note-lines": "true", "midnote:font-size": "large" },
    steps: [
      { wait: 200 },
      { expectText: "Last backup: never" },
      { click: "Back up everything" },
      { wait: 500 },
      { expectDownloadCount: 1 },
      { expectDownload: { ext: ".mdix", magic: "// Brought to u by MidManStudio", minBytes: 300, contains: ["@DATA(", 'app = "midnote-backup"', "format = 2", "Smoke test note", "Smoke test todo", "Smoke test board", "counts = { notes = 1, todos = 1, boards = 1, folders = 0, trashed = 0, themes = 0, icons = 0, fonts = 0 }", "entries::", "settings::", '{ key = "midnote:note-lines", value = "true" }', '{ key = "midnote:font-size", value = "large" }'] } },
      { expectText: "Backup saved" },
      { expectNoText: "Last backup: never" },
    ],
  },
  {
    name: "settings — backup: restore from an older .json backup still works (preview only)",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    steps: [
      { wait: 200 },
      { chooseFile: { selector: 'input[type="file"]', name: "midnote-backup.json", text: RESTORE_BACKUP_TEXT } },
      { wait: 400 },
      { expectText: "Restore this backup?" },
      { expectText: "1 to add" },
      { expectText: "1 to update" },
      { expectText: "2 theme/icon/fonts to add" },
      { expectNotStored: "Restored note from backup" },
    ],
  },
  {
    name: "settings — backup: restore merges, newer copy wins, nothing is deleted (.mdix)",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    steps: [
      { wait: 200 },
      { chooseFile: { selector: 'input[type="file"]', name: "midnote-backup-2026-10-01-1000.mdix", text: RESTORE_BACKUP_MDIX } },
      { wait: 400 },
      { expectText: "Restore this backup?" },
      // the note is already here and not older (kept), the todo in the file is NEWER (updated), the
      // second note is new (added), plus a theme and a font to add
      { expectText: "1 to add" },
      { expectText: "1 to update" },
      { expectText: "1 already here" },
      { expectText: "2 theme/icon/fonts to add" },
      // nothing is touched until Restore is pressed
      { expectNotStored: "Restored note from backup" },
      { click: "Restore backup" },
      { wait: 800 },
      { expectText: "Restore finished" },
      { expectText: "1 added, 1 updated to the newer copy, 1 already here (kept)" },
      { expectText: "Added 1 theme, 1 font" },
      { expectText: "restart the app" },
      { expectSelector: '[aria-label="Restart now"]' },
      { expectStored: "Restored note from backup" },
      { expectStored: "Todo from the future" },
      { expectNotStored: '"title":"Smoke test todo"' },
      { expectStored: "Smoke test note" },
      { expectStored: "Smoke test board" },
      { expectStored: "restored-tag" },
      { expectStored: "data:image/png;base64,AAAA" },
    ],
  },
  // Round E: password-protected backups (.mdix.enc + .mdix.key) with a stand-in for the Rust encryption (scenario.backupCrypto).
  {
    name: "settings — backup: password protect saves an encrypted .mdix.enc and its .mdix.key",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    backupCrypto: true,
    steps: [
      { wait: 200 },
      { click: "Protect backup with a password" },
      { click: "Back up everything" },
      { wait: 200 },
      { expectText: "Protect this backup" },
      { type: { selector: 'input[placeholder="Password"]', value: "open-sesame" } },
      { type: { selector: 'input[placeholder="Confirm password"]', value: "open-sesame" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 600 },
      { expectDownloadCount: 2 },
      // the encrypted file is binary and shows none of the notes; the key file is the DixScript key file text
      { expectDownload: { find: true, ext: ".mdix.enc", binary: true, minBytes: 100, notContains: ["Smoke test note", "Smoke test todo", "midnote-backup", "open-sesame"] } },
      { expectDownload: { find: true, ext: ".mdix.key", magic: "// DixScript Key File", contains: ["key_type"], notContains: ["open-sesame", "Smoke test note"] } },
      { expectText: "Backup saved" },
      { expectText: "keep the backup AND its key file" },
      { expectGlobalIncludes: { name: "__backupCryptoCalls", substring: "lock" } },
    ],
  },
  {
    name: "settings — backup: password mismatch is refused, nothing is saved",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    backupCrypto: true,
    steps: [
      { wait: 200 },
      { click: "Protect backup with a password" },
      { click: "Back up everything" },
      { wait: 200 },
      { type: { selector: 'input[placeholder="Password"]', value: "one-password" } },
      { type: { selector: 'input[placeholder="Confirm password"]', value: "another-password" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 100 },
      { expectText: "Passwords don't match." },
      { expectDownloadCount: 0 },
      { clickSelector: ".dialog .cancel" },
      { wait: 300 },
      { expectDownloadCount: 0 },
      { expectNoText: "Backup saved" },
      { expectNoSelector: ".dialog" },
    ],
  },
  {
    name: "settings — backup: password protect outside the installed app says so",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    steps: [
      { wait: 200 },
      { click: "Protect backup with a password" },
      { click: "Back up everything" },
      { wait: 300 },
      { expectText: "only works in the installed app" },
      { expectDownloadCount: 0 },
    ],
  },
  {
    name: "settings — backup: encrypted round trip (wrong password first, then the right one)",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    backupCrypto: true,
    steps: [
      { wait: 200 },
      { click: "Protect backup with a password" },
      { click: "Back up everything" },
      { wait: 200 },
      { type: { selector: 'input[placeholder="Password"]', value: "open-sesame" } },
      { type: { selector: 'input[placeholder="Confirm password"]', value: "open-sesame" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 600 },
      { expectDownloadCount: 2 },
      // pick BOTH files together, as the real picker would
      { chooseFile: { selector: 'input[aria-label="Backup file"]', files: [{ fromDownload: ".mdix.enc" }, { fromDownload: ".mdix.key" }] } },
      { wait: 300 },
      { expectText: "Backup password" },
      { type: { selector: 'input[placeholder="Password"]', value: "not-the-password" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 400 },
      // asked again, with the reason; nothing is previewed yet
      { expectText: "Wrong password, or this key file belongs to a different backup" },
      { expectNoText: "Restore this backup?" },
      { type: { selector: 'input[placeholder="Password"]', value: "open-sesame" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 600 },
      { expectText: "Restore this backup?" },
      { expectText: "Contains 1 note · 1 todo · 1 board" },
      { expectText: "Nothing to restore" },
      { expectGlobalIncludes: { name: "__backupCryptoCalls", substring: "unlock" } },
    ],
  },
  {
    name: "settings — backup: encrypted file picked alone asks for its key file, then opens",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    backupCrypto: true,
    steps: [
      { wait: 200 },
      { click: "Protect backup with a password" },
      { click: "Back up everything" },
      { wait: 200 },
      { type: { selector: 'input[placeholder="Password"]', value: "open-sesame" } },
      { type: { selector: 'input[placeholder="Confirm password"]', value: "open-sesame" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 600 },
      { chooseFile: { selector: 'input[aria-label="Backup file"]', files: [{ fromDownload: ".mdix.enc" }] } },
      { wait: 300 },
      { expectText: "Key file needed" },
      { expectSelector: '[aria-label="Pick key file"]' },
      { expectNoSelector: ".dialog" },
      { chooseFile: { selector: 'input[aria-label="Key file"]', files: [{ fromDownload: ".mdix.key" }] } },
      { wait: 300 },
      { expectNoText: "Key file needed" },
      { expectText: "Backup password" },
      { type: { selector: 'input[placeholder="Password"]', value: "open-sesame" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 600 },
      { expectText: "Restore this backup?" },
    ],
  },
  {
    name: "settings — backup: cancelling the password prompt on restore opens nothing",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    backupCrypto: true,
    steps: [
      { wait: 200 },
      { click: "Protect backup with a password" },
      { click: "Back up everything" },
      { wait: 200 },
      { type: { selector: 'input[placeholder="Password"]', value: "open-sesame" } },
      { type: { selector: 'input[placeholder="Confirm password"]', value: "open-sesame" } },
      { clickSelector: ".dialog .confirm" },
      { wait: 600 },
      { chooseFile: { selector: 'input[aria-label="Backup file"]', files: [{ fromDownload: ".mdix.enc" }, { fromDownload: ".mdix.key" }] } },
      { wait: 300 },
      { expectText: "Backup password" },
      { clickSelector: ".dialog .cancel" },
      { wait: 300 },
      { expectNoText: "Restore this backup?" },
      { expectNoText: "Key file needed" },
      { expectNoSelector: ".dialog" },
    ],
  },
  {
    name: "settings — backup: a key file on its own is explained",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    steps: [
      { wait: 200 },
      { chooseFile: { selector: 'input[aria-label="Backup file"]', files: [{ name: "x.mdix.key", text: '// DixScript Key File v1.0.0\n@CONFIG(\n  key_type -> "password",\n)\n' }] } },
      { wait: 300 },
      { expectText: "That's a key file" },
      { expectNoText: "Restore this backup?" },
    ],
  },
  { name: "settings — backup: a file that isn't a backup", path: "/settings/backup", seed: SEED_ENTRIES, steps: [{ wait: 200 }, { chooseFile: { selector: 'input[type="file"]', name: "notes.txt", text: "hello world" } }, { wait: 300 }, { expectText: "That isn't a MidNote backup." }, { expectNoText: "Restore this backup?" }] },
  { name: "settings — backup: a backup from a newer app", path: "/settings/backup", seed: SEED_ENTRIES, steps: [{ wait: 200 }, { chooseFile: { selector: 'input[type="file"]', name: "future.json", text: JSON.stringify({ app: "midnote-backup", format: 99 }) } }, { wait: 300 }, { expectText: "newer version of MidNote" }] },
  {
    name: "settings — backup: everything already here",
    path: "/settings/backup",
    seed: SEED_ENTRIES,
    steps: [
      { wait: 200 },
      { chooseFile: { selector: 'input[type="file"]', name: "same.json", text: JSON.stringify({ app: "midnote-backup", format: 1, createdAt: "2026-10-01T10:00:00.000Z", entries: [{ ...SEED_ENTRIES[0], lastModified: "2000-01-01T00:00:00.000Z" }] }) } },
      { wait: 300 },
      { expectText: "Nothing to restore" },
      { expectNoSelector: '[aria-label="Restore backup"]' },
      { click: "Cancel restore" },
      { wait: 100 },
      { expectNoText: "Nothing to restore" },
    ],
  },
  { name: "settings — Backup & restore is on the Advanced settings page", path: "/settings", seed: SEED_ENTRIES, steps: [{ wait: 200 }, { expectSelector: '[aria-label="Open Backup & restore settings"]' }, { click: "Open Backup & restore settings" }, { wait: 300 }, { expectSelector: '[aria-label="Back up everything"]' }, { click: "Back" }, { wait: 400 }, { expectSelector: '[aria-label="Open Backup & restore settings"]' }] },
  // Round 44: "Copy content" in a card's ⋮ menu and on the multi-select bar.
  {
    name: "home — note card menu: Copy content",
    path: "/",
    seed: SEED_ENTRIES,
    copy: true,
    steps: [
      { click: "More options" },
      { click: "Copy content" },
      { wait: 200 },
      { expectGlobalCount: { name: "__copied", substring: "Smoke test note", count: 1 } },
      { expectText: "Copied" },
    ],
  },
  {
    name: "home — locked note refuses Copy content",
    path: "/",
    seed: SEED_ENTRIES.map((e) => (e.id === NOTE_ID ? { ...e, encrypted: true, lockKeyMode: "app", lockedPayload: "x" } : e)),
    copy: true,
    steps: [{ click: "More options" }, { click: "Copy content" }, { wait: 200 }, { expectText: "Unlock first" }, { expectGlobalCount: { name: "__copied", substring: "", count: 0 } }],
  },
  {
    name: "home — multi-select: the action bar is pinned to the TOP of the screen",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { longPress: ".note-card" },
      { wait: 200 },
      { expectText: "1 note selected" },
      { expectSelector: '.bar[data-edge="top"]' },
      { expectSelector: '[aria-label="Cancel selection"]' },
    ],
  },
  {
    name: "home — multi-select: Copy content joins the selected notes",
    path: "/",
    seed: [...SEED_ENTRIES, { ...SEED_ENTRIES.find((e) => e.id === NOTE_ID), id: "smoke-test-note-0002", title: "Second note", content: "second body" }],
    copy: true,
    steps: [
      { longPress: ".note-card" },
      { wait: 200 },
      { expectText: "1 note selected" },
      { clickSelector: ".note-card:not(.selected)" },
      { wait: 200 },
      { expectText: "2 notes selected" },
      { click: "Copy content" },
      { wait: 300 },
      { expectGlobalCount: { name: "__copied", substring: "Smoke test note", count: 1 } },
      { expectGlobalIncludes: { name: "__copied", substring: "Second note" } },
      { expectGlobalIncludes: { name: "__copied", substring: "----------" } },
      { expectText: "2 notes on your clipboard" },
      // selection mode ends once something was copied
      { expectNoSelector: '[aria-label="Cancel selection"]' },
    ],
  },
  // Round 44: Repeat in the Reminder sheet. Times are UTC in the test (see TZ in runScenario).
  {
    name: "note — repeating reminder: daily",
    path: `/note/${NOTE_ID}`,
    seed: SEED_ENTRIES,
    reminderBackend: true,
    steps: [
      { click: "More" },
      { click: "Reminder" },
      { type: { label: "Reminder time", value: "09:00" } },
      { type: { label: "Reminder date", value: "2099-01-01" } },
      { click: "Repeat daily" },
      { wait: 100 },
      { click: "Set reminder" },
      { wait: 400 },
      { expectText: "Reminder set" },
      // 21 alarms, one per day, the first at the picked time and the last 20 days later
      { expectGlobalCount: { name: "__reminderCalls", substring: "schedule:", count: 21 } },
      { expectGlobalIncludes: { name: "__reminderCalls", substring: "2099-01-01T09:00:00.000Z:Smoke test note" } },
      { expectGlobalIncludes: { name: "__reminderCalls", substring: "2099-01-21T09:00:00.000Z:Smoke test note" } },
      { expectStored: '"reminderRepeat":{"rule":"daily","anchor":"2099-01-01T09:00"}' },
      { expectStored: '"reminderAt":"2099-01-01T09:00:00.000Z"' },
      // reopening shows the rule, and deleting clears the alarms and the rule in ONE cancel call
      { click: "More" },
      { click: "Reminder" },
      { expectText: "Every day" },
      { click: "Delete reminder" },
      { wait: 300 },
      { expectText: "Reminder deleted" },
      { expectGlobalCount: { name: "__reminderCalls", substring: "cancel:", count: 2 } },
      { expectNotStored: "reminderRepeat\":{\"rule" },
    ],
  },
  // A repeating reminder whose saved date is STALE (the app wasn't opened since the
  // last occurrence) still shows its bell, and the startup top-up moves the saved
  // date on and re-registers the run — without touching "last modified".
  {
    name: "home — repeating reminder: startup top-up",
    path: "/",
    seed: SEED_ENTRIES.map((e) => (e.id === NOTE_ID ? { ...e, reminderAt: "2020-01-01T09:00:00.000Z", reminderRepeat: { rule: "daily", anchor: "2020-01-01T09:00" } } : e)),
    reminderBackend: true,
    steps: [
      { wait: 600 },
      { expectSelector: ".reminder-badge" },
      { expectGlobalCount: { name: "__reminderCalls", substring: "schedule:", count: 21 } },
      { expectNotStored: '"reminderAt":"2020-01-01T09:00:00.000Z"' },
    ],
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
  // Round 46: first-run examples. A fresh install (nothing stored, no earlier decision) gets two
  // notes, a todo and a board; an app that already has entries (an update) gets none; an app whose
  // examples were deleted does not get them back.
  {
    name: "first run — examples on every tab",
    path: "/",
    steps: [
      { expectText: "Shopping List" },
      { expectText: "Meeting Notes" },
      { clickSelector: ".view-tabs button:nth-child(2)" },
      { expectText: "Plan a weekend trip" },
      { clickSelector: ".view-tabs button:nth-child(3)" },
      { expectText: "Launch plan" },
      { expectStored: "sample-todo-weekend-trip" },
      { expectStored: "sample-board-launch-plan" },
      { expectStored: "examples-decided" },
    ],
  },
  { name: "first run — the example todo opens", path: "/todo/sample-todo-weekend-trip", steps: [{ expectText: "Before you go 1/3" }, { expectText: "Packing 0/3" }, { expectText: "Personal" }] },
  { name: "first run — the example board opens", path: "/board/sample-board-launch-plan", steps: [{ expectText: "Research" }, { expectText: "Launch" }] },
  {
    name: "app update — existing entries get no examples",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [{ expectNotStored: "sample-todo-weekend-trip" }, { expectNotStored: "sample-note-shopping-list" }, { expectStored: "examples-decided" }],
  },
  {
    name: "emptied app — the examples do not come back",
    path: "/",
    storage: { "midnote:samples-decided": "examples-decided" },
    steps: [{ expectText: "No notes found." }, { expectNotStored: "sample-note-shopping-list" }, { expectNotStored: "sample-todo-weekend-trip" }],
  },
  // Round 47: folders. The Folders tab is a browser; the other tabs keep listing everything.
  { name: "folders — a fresh install has the Examples folder", path: "/", steps: [{ clickSelector: FOLDER_TAB }, { expectText: "Examples" }, { expectText: "2 notes · 1 todo · 1 board" }, { expectSelector: ".tag" }] },
  {
    name: "folders — open a folder: its items, the inherited tag, the path",
    path: "/",
    steps: [
      { clickSelector: FOLDER_TAB },
      { click: "Folder Examples" },
      { expectText: "Shopping List" },
      { expectText: "Plan a weekend trip" },
      { expectText: "Launch plan" },
      { expectSelector: ".tag.inherited" },
      { expectSelector: 'nav[aria-label="Folder path"] .crumb.here' },
      { click: "Open top level" },
      { expectText: "All folders" },
      { expectSelector: '[aria-label="Folder Examples"]' },
    ],
  },
  {
    name: "folders — a folder's tag reaches the notes tab and filters by it",
    path: "/",
    seed: [smokeFolder("smoke-f-work", "Work", null, ["Work"]), smokeNote("smoke-n-in", "Inside note", "smoke-f-work"), smokeNote("smoke-n-out", "Outside note")],
    steps: [
      { expectText: "Inside note" },
      { expectText: "Outside note" },
      { expectSelector: ".note-card .tag.inherited" },
      { expectSelector: ".chip.inherited" },
      { click: "Filter by Work (from a folder)" },
      { expectText: "Inside note" },
      { expectNoText: "Outside note" },
    ],
  },
  {
    name: "folders — create a folder and a subfolder",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [
      { clickSelector: FOLDER_TAB },
      { click: "Add to this folder" },
      { click: "New folder here" },
      { type: { label: "New folder name", value: "Projects" } },
      { click: "Create folder" },
      { expectText: "This folder is empty." },
      { expectStored: "Projects" },
      { click: "Add to this folder" },
      { click: "New folder here" },
      { type: { label: "New folder name", value: "Q4" } },
      { click: "Create folder" },
      { expectStored: "Q4" },
      { expectStored: '"parentId":"' },
      { expectSelector: '[aria-label="Open Projects"]' },
      { expectSelector: '[aria-label="Open Q4"]' },
    ],
  },
  {
    name: "folders — an empty name is refused",
    path: "/",
    seed: SEED_ENTRIES,
    steps: [{ clickSelector: FOLDER_TAB }, { click: "Add to this folder" }, { click: "New folder here" }, { click: "Create folder" }, { expectText: "Give the folder a name" }, { expectNotStored: "Untitled folder" }],
  },
  {
    name: "folders — no folder can be nested past 5 deep",
    path: "/",
    seed: [smokeFolder("smoke-d1", "D1"), smokeFolder("smoke-d2", "D2", "smoke-d1"), smokeFolder("smoke-d3", "D3", "smoke-d2"), smokeFolder("smoke-d4", "D4", "smoke-d3"), smokeFolder("smoke-d5", "D5", "smoke-d4")],
    steps: [
      { clickSelector: FOLDER_TAB },
      { click: "Folder D1" },
      { click: "Folder D2" },
      { click: "Folder D3" },
      { click: "Folder D4" },
      { click: "Folder D5" },
      { click: "Add to this folder" },
      { expectText: "Folders can only be nested 5 deep." },
      { expectNoSelector: '[aria-label="New folder here"]' },
      { expectSelector: '[aria-label="New note here"]' },
    ],
  },
  {
    name: "folders — move a note with the selection bar",
    path: "/",
    seed: [smokeFolder("smoke-f-work", "Work"), smokeNote("smoke-n-alpha", "Alpha")],
    steps: [
      { longPress: ".note-card" },
      { wait: 200 },
      { expectText: "1 note selected" },
      { click: "Move to folder" },
      { click: "Move to Work" },
      { wait: 200 },
      { expectText: "Moved to Work" },
      { expectStored: '"parentId":"smoke-f-work"' },
    ],
  },
  {
    name: "folders — move a note from its card menu",
    path: "/",
    seed: [smokeFolder("smoke-f-work", "Work"), smokeNote("smoke-n-alpha", "Alpha")],
    steps: [{ click: "More options" }, { click: "Move to folder" }, { click: "Move to Work" }, { wait: 200 }, { expectStored: '"parentId":"smoke-f-work"' }],
  },
  {
    name: "folders — the picker refuses a folder's own insides",
    path: "/",
    seed: [smokeFolder("smoke-a", "Alpha folder"), smokeFolder("smoke-b", "Beta folder", "smoke-a")],
    steps: [
      { clickSelector: FOLDER_TAB },
      { longPress: ".row.folder" },
      { wait: 200 },
      { click: "Move to folder" },
      { expectText: "A folder can't go inside itself" },
      { expectText: "A folder can't go inside one of its own subfolders" },
      { expectSelector: '[aria-label="Move to top level"]:not([disabled])' },
      { expectSelector: '[aria-label="Move to Alpha folder"][disabled]' },
      { expectSelector: '[aria-label="Move to Beta folder"][disabled]' },
    ],
  },
  {
    name: "folders — delete a folder only: its contents move up",
    path: "/",
    seed: [smokeFolder("smoke-f-doomed", "Doomed"), smokeNote("smoke-n-kept", "Kept note", "smoke-f-doomed")],
    steps: [
      { clickSelector: FOLDER_TAB },
      { click: "Folder Doomed" },
      { click: "Edit this folder" },
      { click: "Delete folder" },
      { click: "Delete folder only" },
      { wait: 300 },
      { expectSelector: '[aria-label="Note Kept note"]' },
      { expectNoSelector: '[aria-label="Folder Doomed"]' },
      { expectStored: '"deletedAt":"20' },
      // lifted for real: nothing points at the deleted folder any more
      { expectNotStored: '"parentId":"smoke-f-doomed"' },
    ],
  },
  {
    name: "folders — delete a folder and everything inside",
    path: "/",
    seed: [smokeFolder("smoke-f-doomed", "Doomed"), smokeNote("smoke-n-kept", "Kept note", "smoke-f-doomed")],
    steps: [
      { clickSelector: FOLDER_TAB },
      { click: "Folder Doomed" },
      { click: "Edit this folder" },
      { click: "Delete folder" },
      { click: "Delete folder and everything inside" },
      { wait: 300 },
      { expectText: "No folders yet." },
      { expectNoSelector: '[aria-label="Note Kept note"]' },
      // trashed together: the note still remembers its folder, so restoring both puts it back inside
      { expectStored: '"parentId":"smoke-f-doomed"' },
    ],
  },
  {
    name: "folders — a new note made inside a folder is filed there",
    path: "/",
    seed: [smokeFolder("smoke-f-work", "Work")],
    steps: [
      { clickSelector: FOLDER_TAB },
      { click: "Folder Work" },
      { click: "Add to this folder" },
      { click: "New note here" },
      { wait: 400 },
      { type: { label: "Note title", value: "Filed note" } },
      { click: "Save" },
      { wait: 600 },
      { expectStored: "Filed note" },
      { expectStored: '"parentId":"smoke-f-work"' },
    ],
  },
  { name: "folders — backup counts folders", path: "/settings/backup", seed: [smokeFolder("smoke-f-work", "Work")], steps: [{ expectText: "1 folder" }] },

  // ---- Round B: accounts (sign up / sign in / sign out) against a fake Supabase (scenario.online) ----
  ...accountScenarios(),
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
        ...(scenario.copy ? { SMOKE_COPY: "fake" } : {}),
        ...(scenario.online ? { SMOKE_ONLINE: JSON.stringify(scenario.online) } : {}),
        ...(scenario.backupCrypto ? { SMOKE_BACKUP_CRYPTO: "1" } : {}),
        ...(scenario.tts ? { SMOKE_TTS: scenario.tts === "noevents" ? "fake-noevents" : "fake" } : {}),
        SMOKE_BUILD_DIR: BUILD_DIR,
        SMOKE_ROUTE_PATH: scenario.path,
        SMOKE_SEED_ENTRIES: JSON.stringify(scenario.seed),
        ...(scenario.storage ? { SMOKE_SEED_STORAGE: JSON.stringify(scenario.storage) } : {}),
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
