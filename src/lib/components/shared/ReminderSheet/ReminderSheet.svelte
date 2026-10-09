<script lang="ts">
  // Round 31 — "Reminder" from the Actions sheet of the note, todo and board
  // editors: the FlyNote "Set reminder" screen (select time, select date,
  // SET REMINDER, Delete) as a bottom sheet.
  //
  // The date and time fields are the WebView's own <input type="date"> /
  // <input type="time">, which Android renders as the system pickers — no
  // picker library, and they follow the phone's locale.
  //
  // Order of events when "Set reminder" is pressed (all in utils/reminders.ts):
  //   check the time -> notification permission (asks once) -> channel ->
  //   replace any old alarm -> schedule -> confirm Android really holds it.
  // Only when all of that succeeds is `entry.reminderAt` saved, so what the
  // sheet shows can never claim a reminder that was not actually scheduled.
  // Saving follows the Actions-sheet rule: mutate THIS editor's own `entry`
  // copy, then saveEntry() it (see Pin / Comments).
  //
  // Round 44: "Repeat" (Never / Daily / Weekdays / Weekly / Monthly / Yearly). With
  // a repeat, the date and time picked are the FIRST occurrence; `entry.reminderAt`
  // always holds the NEXT one and `entry.reminderRepeat` the rule (the app keeps
  // the alarms going — utils/reminders.ts, RECURRING REMINDERS).
  import Sheet from "$lib/components/ui/Sheet/Sheet.svelte";
  import { saveEntry } from "$lib/stores/entries.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import {
    setReminder,
    clearReminder,
    getBackend,
    combineDateTime,
    defaultReminderTime,
    toDateInputValue,
    toTimeInputValue,
    reminderPresets,
    validateReminderTime,
    formatReminderWhen,
    formatCountdown,
  } from "$lib/utils/reminders";
  import { REPEAT_RULES, describeRepeat, reminderDueAt } from "$lib/utils/reminderRepeat";
  import type { ReminderRepeatRule } from "$lib/types/entry";
  import type { Entry } from "$lib/types/entry";

  let { open = $bindable(false), entry }: { open?: boolean; entry: Entry } = $props();

  let dateValue = $state("");
  let timeValue = $state("");
  let error = $state("");
  let busy = $state<"set" | "delete" | null>(null);

  const supported = $derived(getBackend().supported());
  // When it next goes off — computed from the rule for a repeating reminder, so it
  // is right even if the saved date is stale (the app hasn't been opened since).
  const dueAt = $derived(reminderDueAt(entry));
  const active = $derived(dueAt !== null);
  let repeatValue = $state<ReminderRepeatRule | "">("");
  const presets = $derived(open ? reminderPresets() : []);

  // Each time the sheet opens, start from the current reminder if there is
  // one, otherwise from the next sensible hour.
  $effect(() => {
    if (!open) return;
    const start = dueAt ? new Date(dueAt) : defaultReminderTime();
    dateValue = toDateInputValue(start);
    timeValue = toTimeInputValue(start);
    repeatValue = entry.reminderRepeat?.rule ?? "";
    error = "";
  });

  function applyPreset(at: Date) {
    dateValue = toDateInputValue(at);
    timeValue = toTimeInputValue(at);
    error = "";
  }

  async function onSet() {
    if (busy) return;
    const at = combineDateTime(dateValue, timeValue);
    const bad = validateReminderTime(at);
    if (bad || !at) {
      error = bad ?? "Pick a date and a time.";
      return;
    }
    busy = "set";
    error = "";
    breadcrumb(`reminder: set requested for ${entry.type} ${entry.id} at ${at.toISOString()}`);
    const result = await setReminder(entry, at, undefined, undefined, repeatValue || null);
    busy = null;
    if (!result.ok) {
      breadcrumb(`reminder: set failed (${result.reason}): ${result.message}`);
      error = result.message;
      return;
    }
    if (result.route) breadcrumb(`reminder: scheduled via ${result.route}`);
    entry.reminderAt = result.at;
    entry.reminderRepeat = result.repeat;
    saveEntry(entry);
    pushToast({
      title: "Reminder set",
      description: `${formatReminderWhen(result.at)}${result.repeat ? ` · ${describeRepeat(result.repeat).toLowerCase()}` : ""}`,
    });
    open = false;
  }

  async function onDelete() {
    if (busy) return;
    busy = "delete";
    error = "";
    const result = await clearReminder(entry.id);
    busy = null;
    if (!result.ok) {
      error = result.message;
      return;
    }
    breadcrumb(`reminder: deleted for ${entry.type} ${entry.id}`);
    entry.reminderAt = null;
    entry.reminderRepeat = null;
    saveEntry(entry);
    pushToast({ title: "Reminder deleted" });
    open = false;
  }
</script>

<Sheet bind:open side="bottom" title="Reminder">
  <div class="reminder">
    {#if !supported}
      <p class="info">Reminders are sent as Android notifications, so they only work in the installed Android app — not in this preview.</p>
    {:else}
      {#if dueAt}
        <div class="current" role="status">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <div class="current-text">
            <span class="when">{formatReminderWhen(dueAt)}</span>
            <span class="countdown">{formatCountdown(dueAt)}{entry.reminderRepeat ? ` · ${describeRepeat(entry.reminderRepeat)}` : ""}</span>
          </div>
        </div>
      {/if}

      <div class="field-row">
        <label for="reminder-time">Select time</label>
        <input id="reminder-time" type="time" bind:value={timeValue} aria-label="Reminder time" />
      </div>
      <div class="field-row">
        <label for="reminder-date">Select date</label>
        <input id="reminder-date" type="date" bind:value={dateValue} aria-label="Reminder date" />
      </div>

      <div class="repeat" role="group" aria-label="Repeat">
        <span class="repeat-label">Repeat</span>
        <div class="repeat-options">
          <button type="button" class="chip" class:on={repeatValue === ""} aria-pressed={repeatValue === ""} aria-label="Repeat never" onclick={() => (repeatValue = "")}>Never</button>
          {#each REPEAT_RULES as r (r.rule)}
            <button type="button" class="chip" class:on={repeatValue === r.rule} aria-pressed={repeatValue === r.rule} aria-label={`Repeat ${r.label.toLowerCase()}`} onclick={() => (repeatValue = r.rule)}>{r.label}</button>
          {/each}
        </div>
      </div>

      <div class="presets" aria-label="Quick picks">
        {#each presets as p (p.label)}
          <button type="button" class="chip" aria-label={p.label} onclick={() => applyPreset(p.at)}>{p.label}</button>
        {/each}
      </div>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <button type="button" class="primary" onclick={onSet} disabled={busy !== null} aria-label="Set reminder">
        {busy === "set" ? "Setting…" : active ? "Update reminder" : "Set reminder"}
      </button>

      {#if active}
        <button type="button" class="danger" onclick={onDelete} disabled={busy !== null} aria-label="Delete reminder">
          {busy === "delete" ? "Deleting…" : "Delete reminder"}
        </button>
      {/if}

      <p class="hint">
        You'll get a notification at that time{repeatValue ? ", and again each time it repeats" : ""}. Tapping it opens this {entry.type === "regular" ? "note" : entry.type}.
      </p>
    {/if}
  </div>
</Sheet>

<style>
  .reminder {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .info {
    margin: var(--space-3) 0;
    font-size: 13px;
    color: var(--text-lo);
    text-align: center;
    line-height: 1.45;
  }
  .current {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md, 12px);
    background: var(--surface);
    border: 1px solid var(--accent-dim);
    color: var(--accent);
  }
  .current-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .when {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .countdown {
    font-size: 12px;
    color: var(--text-lo);
  }
  .field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .field-row label {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .field-row input {
    font-family: var(--font-sans);
    font-size: 16px;
    color: var(--text-hi);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 8px var(--space-3);
    min-height: 40px;
    color-scheme: dark;
  }
  .field-row input:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    padding: 8px var(--space-3);
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--text-hi);
    font-family: var(--font-sans);
    font-size: 13px;
    cursor: pointer;
  }
  .repeat {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .repeat-label {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .repeat-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  .error {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--danger);
  }
  .primary,
  .danger {
    height: 46px;
    border: none;
    border-radius: 999px;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--bg);
  }
  .danger {
    background: transparent;
    color: var(--danger);
    border: 1px solid var(--danger);
  }
  .primary:disabled,
  .danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint);
    text-align: center;
  }
</style>
