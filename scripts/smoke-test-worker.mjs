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
// Optional, per-scenario — see smoke-test.mjs's SCENARIOS comment on
// `expectText` for why this exists alongside the crash-only check below:
// a route can mount and settle with zero thrown errors while still
// silently showing the wrong content (stale/reset/blank state), which
// no amount of "did it throw" checking catches.
const EXPECT_TEXT = process.env.SMOKE_EXPECT_TEXT || null;
// Optional, per-scenario — see smoke-test.mjs's SCENARIOS comment on
// `clickAriaLabel` for why this exists: mounting a route and waiting is
// the whole test above, which means nothing a user actually DOES (tap
// Save, type into a field) was ever exercised — a crash that only
// happens inside a click handler (round 24's real on-device
// DataCloneError, thrown from Save, never from mounting) sailed through
// every previous run of this file clean. This clicks one real element
// after the initial settle, matched by its exact aria-label, then waits
// again before the usual error/expectText checks run.
const CLICK_ARIA_LABEL = process.env.SMOKE_CLICK_ARIA_LABEL || null;
// Optional, per-scenario (round 26) — an ordered list of scripted
// interactions (click / type / expectSelector / expectText); see
// smoke-test.mjs's `steps` comment for the step shapes and why.
const STEPS = JSON.parse(process.env.SMOKE_STEPS || "[]");

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

// jsdom also doesn't implement matchMedia. @xyflow/svelte calls it while
// constructing its store (colorMode resolution — it checks
// prefers-color-scheme), so the board route can't mount without it.
// This is a jsdom gap, NOT an app bug: matchMedia is supported in
// Android WebView and every browser this app targets, so stubbing it
// here is making the harness match reality, not papering over a real
// failure. Reports "no match" for every query, which for colorMode
// resolution means the explicit colorMode prop wins — exactly what
// happens in the real app, where that prop is always set.
function fakeMatchMedia(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  };
}
w.matchMedia = fakeMatchMedia;

// Same category as matchMedia above — jsdom has no ResizeObserver, but
// every browser this app targets (Android WebView included) does.
// @xyflow/svelte observes its own container to track the canvas size
// for pan/zoom math, so the board route can't mount without it. The
// stub never fires a callback, which is correct for this harness: it
// means the canvas keeps its initial (zero) measured size and simply
// renders nothing visible, rather than the route throwing. What's
// under test here is "does this route mount and settle without
// crashing", not layout.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
w.ResizeObserver = FakeResizeObserver;

// Third jsdom gap of the same kind. jsdom ships SVGElement and
// SVGGraphicsElement but NOT SVGAElement (an <a> inside an SVG) — Svelte's
// own client runtime references it while deciding how to handle an
// element's attributes, which any route rendering SVG reaches. Real
// browsers all define it. Subclassing jsdom's real SVGGraphicsElement
// rather than inventing a bare class keeps `instanceof` checks against
// the SVG hierarchy behaving correctly.
class FakeSVGAElement extends w.SVGGraphicsElement {}
w.SVGAElement = FakeSVGAElement;

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
  "URLSearchParams", "MutationObserver", "getSelection",
  "TextEncoder", "TextDecoder", "btoa", "atob", "sessionStorage", "localStorage",
  "pageXOffset", "pageYOffset", "scrollX", "scrollY", "innerWidth", "innerHeight",
  "getComputedStyle", "matchMedia", "requestIdleCallback", "cancelIdleCallback",
];
// NOTE (round 26): "performance" used to be in the list above and must
// NOT be. jsdom's own Performance.now() is implemented by calling the
// GLOBAL `performance.now()` — and copying jsdom's performance object over
// the global makes that call itself, forever (RangeError: Maximum call
// stack size exceeded, from inside jsdom, the moment ANY app code calls
// performance.now()). Node ships its own working global `performance`,
// which is what jsdom's implementation wants to find there; window.performance
// (jsdom's) still exists and delegates to it. Found when the find & replace
// plugin's search-budget timer ran under this harness.
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
global.matchMedia = fakeMatchMedia;
global.ResizeObserver = FakeResizeObserver;
global.SVGAElement = FakeSVGAElement;
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

if (CLICK_ARIA_LABEL && errors.length === 0) {
  const el = target.querySelector(`[aria-label="${CLICK_ARIA_LABEL}"]`);
  if (!el) {
    errors.push(new Error(`No element with aria-label="${CLICK_ARIA_LABEL}" found to click.`));
  } else {
    el.click();
    // A shorter second wait than the initial SETTLE_MS — this is only
    // waiting on whatever the click's own handler kicks off (a save's
    // in-memory update + fire-and-forget persist, an $effect it
    // triggers), not a full route mount.
    await new Promise((r) => setTimeout(r, Math.min(SETTLE_MS, 600)));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (STEPS.length > 0 && errors.length === 0) {
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    const where = `steps[${i}] ${JSON.stringify(step)}`;
    if (step.click) {
      const el = target.querySelector(`[aria-label="${step.click}"]`);
      if (!el) {
        errors.push(new Error(`${where}: no element with aria-label="${step.click}" to click.`));
        break;
      }
      el.click();
    } else if (step.type) {
      const el = target.querySelector(`[aria-label="${step.type.label}"]`);
      if (!el) {
        errors.push(new Error(`${where}: no input with aria-label="${step.type.label}" to type into.`));
        break;
      }
      el.value = step.type.value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
    } else if (step.paste !== undefined) {
      // Round 27: fire a real `paste` event (with a text/plain clipboard)
      // at the live Tiptap editor. jsdom has no ClipboardEvent or
      // DataTransfer, so the event is a plain Event carrying the one
      // property (`clipboardData.getData`) the app's handler reads.
      const pm = target.querySelector(".ProseMirror");
      if (!pm) {
        errors.push(new Error(`${where}: no .ProseMirror editor to paste into.`));
        break;
      }
      const ev = new w.Event("paste", { bubbles: true, cancelable: true });
      ev.clipboardData = { getData: (t) => (t === "text/plain" ? step.paste : "") };
      pm.dispatchEvent(ev);
      if (!ev.defaultPrevented) {
        errors.push(new Error(`${where}: the paste event wasn't handled (defaultPrevented is false) — the plain-text paste handler isn't wired into the editor.`));
        break;
      }
    } else if (step.expectSelector) {
      if (!target.querySelector(step.expectSelector)) {
        errors.push(new Error(`${where}: nothing matched ${step.expectSelector}.`));
        break;
      }
    } else if (step.expectText) {
      if (!target.textContent.includes(step.expectText)) {
        errors.push(new Error(`${where}: page text doesn't contain "${step.expectText}". Actual: ${target.textContent.trim().slice(0, 200)}`));
        break;
      }
    }
    await sleep(step.wait ?? 250);
  }
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error((e && e.stack) || (e && e.message) || String(e));
  }
  process.exit(1);
}

if (EXPECT_TEXT && !target.textContent.includes(EXPECT_TEXT)) {
  console.error(`Expected the settled page to contain "${EXPECT_TEXT}", but it didn't.`);
  console.error(`Actual visible text: ${target.textContent.trim().slice(0, 300) || "(empty)"}`);
  process.exit(1);
}

process.exit(0);
