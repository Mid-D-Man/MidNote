<script lang="ts">
  import "../lib/tokens.css";
  import Toast from "$lib/components/ui/Toast/Toast.svelte";
  import LockPrompt from "$lib/components/shared/LockPrompt/LockPrompt.svelte";
  import LoadingOverlay from "$lib/components/ui/LoadingOverlay/LoadingOverlay.svelte";
  import LoadingScreen from "$lib/components/layout/LoadingScreen/LoadingScreen.svelte";
  import DebugPanel from "$lib/components/debug/DebugPanel.svelte";
  import { installGlobalCapture } from "$lib/debug/log.svelte";
  import { debugPanelVisible } from "$lib/stores/settings.svelte";
  import { initFromBackend } from "$lib/stores/entries.svelte";
  import { sync as syncTags } from "$lib/stores/tags.svelte";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // Moved here from +page.svelte (round 22): that file's own local
  // isLoading/LoadingScreen only ever gated its own markup, which was
  // fine back when everything storage.ts returned was already sitting
  // in localStorage by the time any component's <script> ran. Now that
  // storage.ts's real data arrives from an async Tauri round trip (see
  // that file's header), gating has to live at the ROOT layout instead —
  // every route (note/[id], todo/[id], board/[id], not just the landing
  // page) reads from the same entries.svelte.ts store, and a direct
  // navigation to one of those (a restored route on relaunch, a
  // hot-reload landing mid-route in dev) needs the exact same guarantee
  // the landing page needed: nothing downstream mounts, and so nothing
  // downstream can call getEntry()/loadEntries() for real data, before
  // that data actually exists. `storageReady` is the real signal;
  // `isLoading` is kept alongside it purely so the splash's own ~1.3s
  // animated progress bar still plays out for a moment even on the
  // fast localStorage-fallback dev path, rather than flashing instantly
  // — the overlay only ever clears once BOTH are satisfied.
  let isLoading = $state(true);
  let storageReady = $state(false);

  onMount(() => {
    // Capture always runs regardless of the panel's own visibility
    // setting — see settings.svelte.ts's comment on debugPanelVisible.
    installGlobalCapture();

    (async () => {
      await initFromBackend();
      // Same explicit-ordering reasoning tags.svelte.ts's own sync()
      // comment already documented: called here, once, right after
      // entries' own first-run seeding is guaranteed to have already
      // run (initFromBackend awaits storage.initStorage() and does its
      // own seeding check before returning) — not relying on
      // module-evaluation order between the two stores.
      syncTags();
      storageReady = true;
    })();
  });
</script>

{#if isLoading || !storageReady}
  <LoadingScreen oncomplete={() => (isLoading = false)} />
{:else}
  {@render children()}
{/if}
<Toast />
<LockPrompt />
<LoadingOverlay />
{#if debugPanelVisible.value}
  <DebugPanel />
{/if}
