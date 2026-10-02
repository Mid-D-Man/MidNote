// Round 33 — reactive list of imported fonts. Same shape as
// customIcons.svelte.ts / customThemes.svelte.ts (Svelte 5 runes state, list
// mutated in place under untrack) but backed by IndexedDB through
// utils/fontLibrary.ts instead of localStorage — see that file's header for
// why fonts can't live in localStorage.
//
// Loading is async, so the list starts empty and fills a moment after the
// app boots (initCustomFonts, called once from +layout.svelte). A note that
// uses an imported font paints in the fallback face for that moment and
// swaps when the font registers; nothing else waits on it.
import { untrack } from "svelte";
import { breadcrumb } from "$lib/debug/log.svelte";
import { FontLibrary, browserFaceHost, idbBackend, memoryBackend, type AddResult, type CustomFont } from "$lib/utils/fontLibrary";
import { primaryFamily } from "$lib/utils/fonts";
import { noteFont, setNoteFont } from "$lib/stores/settings.svelte";

export const customFonts = $state<CustomFont[]>([]);
/** false until the first load finishes; "session" means IndexedDB wasn't usable so fonts last only until the app closes. */
export const fontStore = $state<{ ready: boolean; storage: "persistent" | "session" | "unknown" }>({ ready: false, storage: "unknown" });

let library: Promise<FontLibrary> | null = null;

function getLibrary(): Promise<FontLibrary> {
  if (!library) {
    library = (async () => {
      let backend;
      try {
        if (typeof indexedDB === "undefined") throw new Error("indexedDB is not available");
        backend = await idbBackend();
      } catch (err) {
        breadcrumb(`fonts: persistent storage unavailable (${err instanceof Error ? err.message : String(err)}) — imported fonts last until the app closes`);
        backend = memoryBackend();
      }
      fontStore.storage = backend.persistent ? "persistent" : "session";
      return new FontLibrary(backend, browserFaceHost(), breadcrumb);
    })();
  }
  return library;
}

function setList(next: CustomFont[]) {
  untrack(() => {
    customFonts.splice(0, customFonts.length, ...next);
  });
}

let initStarted = false;

/** Load and register every stored font. Safe to call more than once; never throws. */
export async function initCustomFonts(): Promise<void> {
  if (initStarted) return;
  initStarted = true;
  try {
    const lib = await getLibrary();
    setList(await lib.load());
    breadcrumb(`fonts: ${customFonts.length} imported font(s) ready`);
  } catch (err) {
    breadcrumb(`fonts: load failed (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    fontStore.ready = true;
  }
}

export async function addCustomFont(file: File): Promise<AddResult> {
  const lib = await getLibrary();
  const result = await lib.add(file, customFonts);
  if (result.ok) {
    setList([...customFonts, result.font].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
  }
  return result;
}

export async function removeCustomFont(id: string): Promise<boolean> {
  const font = customFonts.find((f) => f.id === id);
  if (!font) return false;
  const lib = await getLibrary();
  if (!(await lib.remove(id))) return false;
  setList(customFonts.filter((f) => f.id !== id));
  // The default note font was this one: put the default back rather than
  // leave a setting that points at nothing.
  if (primaryFamily(noteFont.value) === font.name.toLowerCase()) setNoteFont(null);
  return true;
}
