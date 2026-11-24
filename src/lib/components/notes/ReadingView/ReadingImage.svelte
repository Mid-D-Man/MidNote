<script lang="ts">
  // One picture of a PowerPoint / PDF / Word note, shown from the phone's own copy (utils/docImageStore.ts). The address it is
  // shown from is made when the picture appears and freed when it goes. A picture that isn't there says so instead of leaving a hole.
  // State is written from onMount and its promise only.
  import { onMount } from "svelte";
  import { loadDocImageUrl } from "$lib/utils/docImageStore";

  let { imageKey, alt }: { imageKey: string; alt: string } = $props();

  let url = $state<string | null>(null);
  let missing = $state(false);

  onMount(() => {
    let revoke: (() => void) | null = null;
    let gone = false;
    void loadDocImageUrl(imageKey).then((r) => {
      if (gone) {
        r?.revoke();
        return;
      }
      if (!r) {
        missing = true;
        return;
      }
      url = r.url;
      revoke = r.revoke;
    });
    return () => {
      gone = true;
      revoke?.();
    };
  });
</script>

{#if url}
  <img class="rv-img" src={url} {alt} loading="lazy" decoding="async" />
{:else if missing}
  <p class="rv-img-missing">Picture not available on this phone.</p>
{:else}
  <div class="rv-img-wait" aria-hidden="true"></div>
{/if}
