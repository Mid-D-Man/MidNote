<script lang="ts">
  import "../lib/tokens.css";
  import Toast from "$lib/components/ui/Toast/Toast.svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
<Toast />
