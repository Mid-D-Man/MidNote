<script lang="ts">
  import "../lib/tokens.css";
  import Toast from "$lib/components/ui/Toast/Toast.svelte";
  import DebugPanel from "$lib/components/debug/DebugPanel.svelte";
  import { installGlobalCapture } from "$lib/debug/log.svelte";
  import { debugPanelVisible } from "$lib/stores/settings.svelte";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    // Capture always runs regardless of the panel's own visibility
    // setting — see settings.svelte.ts's comment on debugPanelVisible.
    installGlobalCapture();
  });
</script>

{@render children()}
<Toast />
{#if debugPanelVisible.value}
  <DebugPanel />
{/if}
