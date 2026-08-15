<script lang="ts">
  import "../lib/tokens.css";
  import Toast from "$lib/components/ui/Toast/Toast.svelte";
  import DebugPanel from "$lib/components/debug/DebugPanel.svelte";
  import { installGlobalCapture } from "$lib/debug/log.svelte";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    installGlobalCapture();
  });
</script>

{@render children()}
<Toast />
<DebugPanel />
