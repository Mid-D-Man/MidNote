<script lang="ts">
  // Lets a note/todo's tags be edited straight from the ⋮ overflow menu
  // on the landing page, without opening the full editor — reuses the
  // exact same TagSelector the editor headers already use, just hosted
  // in its own Sheet instead of inline in a header row.
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import TagSelector from "$lib/components/shared/TagSelector/TagSelector.svelte";

  let {
    open = $bindable(false),
    tags,
    availableTags,
    onAddTag,
    onRemoveTag,
  }: {
    open?: boolean;
    tags: string[];
    availableTags: string[];
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
  } = $props();
</script>

<Sheet bind:open side="bottom" title="Tags">
  <TagSelector selectedTags={tags} {availableTags} {onAddTag} {onRemoveTag} />
</Sheet>
