<!--
  Bell shown on a list card whose entry has a reminder that hasn't gone off
  yet (round 31). Sits next to LockBadge in the title row and follows the
  same colour rule, so it stays legible over an image theme. The caller
  decides when to show it (isActiveReminder in utils/reminders.ts); `at` only
  feeds the tooltip text.
-->
<script lang="ts">
  import { formatReminderWhen } from "$lib/utils/reminders";

  let { at, size = 14 }: { at: string; size?: number } = $props();
  const label = $derived(`Reminder ${formatReminderWhen(at)}`);
</script>

<span class="reminder-badge" aria-label={label} title={label}>
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2.2">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
</span>

<style>
  .reminder-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--theme-text-mid, var(--accent));
  }
</style>
