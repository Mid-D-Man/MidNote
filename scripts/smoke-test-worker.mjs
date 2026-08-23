// Runs ONE scenario against the real production build (build/) and exits
// 1 if anything throws while it mounts and settles. Always run through
// smoke-test.mjs, which spawns this as a fresh child process per
// scenario — that isolation matters: Svelte's client runtime and every
// .svelte.ts store keep module-level singleton state, so running two
// scenarios in the same process would let state leak between them and
// produce false passes/fails. A fresh process per scenario is the only
// way to faithfully mirror "the app just launched."
//
// Not meant to be run directly — see smoke-test.mjs / npm run smoke.

import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BUILD_DIR = process.env.SMOKE_BUILD_DIR;
const ROUTE_PATH = process.env.SMOKE_ROUTE_PATH;
const SEED_ENTRIES = JSON.parse(process.env.SMOKE_SEED_ENTRIES || "[]");
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS || 1200);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: `http://tauri.localhost${ROUTE_PATH}`,
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const w = dom.window;

if (SEED_ENTRIES.length > 0) {
  w.localStorage.setItem("midnote:entries", JSON.stringify(SEED_ENTRIES));
}

// jsdom doesn't implement IntersectionObserver; SvelteKit's link-preload
// wiring touches it during start(), so it needs at least a no-op stub.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Bare-identifier browser globals the SvelteKit client runtime and app
// code touch directly (the way real browser globals work — `window`
// properties are implicitly global). Extend this list if a new scenario
// hits a ReferenceError for some other browser API.
const GLOBALS_TO_COPY = [
  "window", "document", "location", "history", "navigator", "customElements",
  "HTMLElement", "Element", "Node", "Text", "Comment", "DocumentFragment",
  "SVGAElement", "SVGElement", "HTMLMediaElement", "HTMLInputElement",
  "HTMLTextAreaElement", "HTMLButtonElement", "HTMLAnchorElement", "HTMLFormElement",
  "HTMLSelectElement", "DOMParser", "Headers", "Request", "Response", "URL",
  "URLSearchParams", "MutationObserver", "getSelection", "performance",
  "TextEncoder", "TextDecoder", "btoa", "atob", "sessionStorage", "localStorage",
  "pageXOffset", "pageYOffset", "scrollX", "scrollY", "innerWidth", "innerHeight",
  "getComputedStyle", "matchMedia", "requestIdleCallback", "cancelIdleCallback",
];
for (const key of GLOBALS_TO_COPY) {
  if (key in w) {
    // defineProperty, not plain assignment — Node has its own read-only
    // built-in globals (navigator, crypto, ...) that a bare `global.x = y`
    // throws on.
    Object.defineProperty(global, key, {
      value: w[key], writable: true, configurable: true, enumerable: true,
    });
  }
}
global.window = w;
global.document = w.document;
global.addEventListener = w.addEventListener.bind(w);
global.removeEventListener = w.removeEventListener.bind(w);
global.dispatchEvent = w.dispatchEvent.bind(w);
global.scrollTo = () => {};
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IntersectionObserver = FakeIntersectionObserver;
global.fetch = async () => new Response("{}", { status: 404 });

// SvelteKit's client entry reads a per-build-hashed global
// (__sveltekit_XXXXX) for its base path — extract the real one from the
// build's own index.html rather than hardcoding it, since it changes on
// every build.
const indexHtml = readFileSync(path.join(BUILD_DIR, "index.html"), "utf-8");
const sveltekitGlobalName = (indexHtml.match(/__sveltekit_\w+/) || [null, "__sveltekit_r5jb0"])[0];
globalThis[sveltekitGlobalName] = { base: "" };

const errors = [];
w.addEventListener("error", (e) => errors.push(e.error ?? e.message));
process.on("unhandledRejection", (err) => errors.push(err));

const target = w.document.createElement("div");
target.style.display = "contents";
w.document.body.appendChild(target);

try {
  const entryDir = path.join(BUILD_DIR, "_app", "immutable", "entry");
  const entryFiles = readdirSync(entryDir);
  const startFile = entryFiles.find((f) => f.startsWith("start."));
  const appFile = entryFiles.find((f) => f.startsWith("app."));
  const startUrl = pathToFileURL(path.join(entryDir, startFile)).href;
  const appUrl = pathToFileURL(path.join(entryDir, appFile)).href;
  const [kit, app] = await Promise.all([import(startUrl), import(appUrl)]);
  await kit.start(app, target);
} catch (err) {
  errors.push(err);
}

// Give effects/microtasks room to settle — or to spiral, if a loop like
// the effect_update_depth_exceeded one is back.
await new Promise((r) => setTimeout(r, SETTLE_MS));

if (errors.length > 0) {
  for (const e of errors) {
    console.error((e && e.stack) || (e && e.message) || String(e));
  }
  process.exit(1);
}
process.exit(0);
