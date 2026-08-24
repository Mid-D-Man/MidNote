<script lang="ts">
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import { debugPanelVisible, setDebugPanelVisible } from "$lib/stores/settings.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<Sheet bind:open side="left" title="Settings">
  <div class="settings-list">
    <div class="settings-row">
      <div class="row-text">
        <span class="row-label">Debug panel</span>
        <span class="row-desc">Show the on-device error/log panel while using the app.</span>
      </div>
      <Switch
        checked={debugPanelVisible.value}
        aria-label="Show debug panel"
        onCheckedChange={(v) => {
          breadcrumb(`settings: debug panel ${v ? "enabled" : "disabled"}`);
          setDebugPanelVisible(v);
        }}
      />
    </div>
  </div>
</Sheet>

<style>
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-hi);
  }
  .row-desc {
    font-size: 12px;
    color: var(--text-faint);
  }
</style>
