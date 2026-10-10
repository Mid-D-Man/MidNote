<script lang="ts">
  // Round 45 — Settings -> Backup & restore.
  //
  //   Back up everything   one .json file: notes, todos, boards (and Trash), tags, themes,
  //                        icons, imported fonts and look-and-feel settings
  //                        (utils/backup.ts has the format and its rules)
  //   Restore from a file  reads a backup, SHOWS what it would do, and only then merges it in:
  //                        nothing on the phone is deleted, a newer copy wins, locked notes stay locked
  //
  // Saving goes through downloadFiles() — the Android-safe save dialog. Picking a file uses a
  // plain <input type="file"> with NO accept filter (Android's picker hides .json files that
  // way, same lesson as the font picker). The file is NOT encrypted; the screen says so.
  import SettingsRow from "./SettingsRow.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import { entries, refresh } from "$lib/stores/entries.svelte";
  import { sync as syncTags } from "$lib/stores/tags.svelte";
  import { customThemes, restoreCustomTheme } from "$lib/stores/customThemes.svelte";
  import { customIcons, restoreCustomIcon } from "$lib/stores/customIcons.svelte";
  import { customFonts, exportCustomFonts, restoreCustomFont } from "$lib/stores/customFonts.svelte";
  import { pushToast } from "$lib/stores/toast.svelte";
  import { breadcrumb } from "$lib/debug/log.svelte";
  import * as storage from "$lib/storage";
  import { downloadFiles } from "$lib/utils/selectionActions";
  import { syncReminderSilently } from "$lib/utils/reminders";
  import {
    applyRestore,
    backupFileName,
    base64ToBytes,
    buildBackup,
    countEntries,
    describeReport,
    parseBackup,
    planRestore,
    serializeBackup,
    type BackupFile,
    type RestorePlan,
    type RestoreSink,
  } from "$lib/utils/backup";
  import type { FontKind } from "$lib/utils/fonts";

  const LAST_BACKUP_KEY = "midnote:last-backup";

  let fileInput = $state<HTMLInputElement | null>(null);
  let busy = $state<"backup" | "reading" | "restoring" | null>(null);
  let progress = $state<{ done: number; total: number } | null>(null);
  let notice = $state<{ kind: "error" | "info"; text: string } | null>(null);
  let pending = $state<{ backup: BackupFile; plan: RestorePlan } | null>(null);
  let report = $state<{ lines: string[]; restart: boolean } | null>(null);
  let lastBackup = $state<string | null>(readLastBackup());

  function readLastBackup(): string | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_BACKUP_KEY);
    } catch {
      return null;
    }
  }

  const counts = $derived(countEntries(entries));
  const mine = $derived(
    [
      plural(counts.notes, "note"),
      plural(counts.todos, "todo"),
      plural(counts.boards, "board"),
      counts.trashed ? `${counts.trashed} in Trash` : "",
      customThemes.length ? plural(customThemes.length, "theme") : "",
      customIcons.length ? plural(customIcons.length, "icon") : "",
      customFonts.length ? plural(customFonts.length, "font") : "",
    ]
      .filter(Boolean)
      .join(" · ")
  );

  function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function when(iso: string | null): string {
    if (!iso) return "never";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function formatSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  // ---------------------------------------------------------------- back up

  async function handleBackup() {
    if (busy) return;
    breadcrumb("backup: back up tapped");
    busy = "backup";
    notice = null;
    report = null;
    try {
      const file = await buildBackup({
        entries: () => storage.loadEntries(),
        tags: () => storage.loadKnownTags(),
        themes: () => customThemes.map((t) => ({ ...t })),
        icons: () => customIcons.map((i) => ({ ...i })),
        fonts: () => exportCustomFonts(),
        setting: (k) => {
          try {
            return localStorage.getItem(k);
          } catch {
            return null;
          }
        },
      });
      const text = serializeBackup(file);
      const blob = new Blob([text], { type: "application/json" });
      const saved = await downloadFiles([{ name: backupFileName(), blob }]);
      if (saved > 0) {
        const iso = new Date().toISOString();
        try {
          localStorage.setItem(LAST_BACKUP_KEY, iso);
        } catch {
          /* not worth failing the backup over */
        }
        lastBackup = iso;
        breadcrumb(`backup: saved ${formatSize(blob.size)} (${file.counts.notes}n ${file.counts.todos}t ${file.counts.boards}b ${file.counts.themes}th ${file.counts.icons}ic ${file.counts.fonts}f)`);
        pushToast({ title: "Backup saved", description: `${formatSize(blob.size)} — keep it somewhere safe.` });
      } else {
        pushToast({ title: "Backup not saved", description: "The save was cancelled." });
      }
    } catch (err) {
      breadcrumb(`backup: failed (${err instanceof Error ? err.message : String(err)})`);
      notice = { kind: "error", text: "Couldn't make the backup. Try again, and tell me if it keeps happening." };
    } finally {
      busy = null;
    }
  }

  // ---------------------------------------------------------------- restore

  function snapshot() {
    return {
      entries: storage.loadEntries().map((e) => ({ id: e.id, lastModified: e.lastModified })),
      themeIds: new Set(customThemes.map((t) => t.id)),
      iconIds: new Set(customIcons.map((i) => i.id)),
      fontIds: new Set(customFonts.map((f) => f.id)),
      fontNames: new Set(customFonts.map((f) => f.name.toLowerCase())),
    };
  }

  async function handlePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // so picking the same file again still fires
    if (!file || busy) return;
    breadcrumb(`backup: restore file picked (${formatSize(file.size)})`);
    busy = "reading";
    notice = null;
    report = null;
    pending = null;
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        notice = { kind: "error", text: parsed.message };
        return;
      }
      const plan = planRestore(parsed.backup, snapshot(), storage.normalizeEntry);
      pending = { backup: parsed.backup, plan };
    } catch (err) {
      breadcrumb(`backup: couldn't read the picked file (${err instanceof Error ? err.message : String(err)})`);
      notice = { kind: "error", text: "Couldn't read that file." };
    } finally {
      busy = null;
    }
  }

  const mediaToAdd = $derived(pending ? pending.plan.themes.length + pending.plan.icons.length + pending.plan.fonts.length : 0);
  const planSize = $derived(
    pending
      ? pending.plan.addEntries.length + pending.plan.updateEntries.length + pending.plan.themes.length + pending.plan.icons.length + pending.plan.fonts.length
      : 0
  );

  function makeSink(): RestoreSink {
    return {
      saveEntry: async (entry) => {
        await storage.upsertEntry(entry, { touch: false }); // keep its own last-modified
      },
      addTheme: (t) => restoreCustomTheme(t),
      addIcon: (i) => restoreCustomIcon(i),
      addFont: async (f) => {
        const bytes = base64ToBytes(f.data);
        return restoreCustomFont({ id: f.id, name: f.name, kind: f.kind as FontKind, size: bytes.length, addedAt: f.addedAt, bytes: bytes.buffer as ArrayBuffer });
      },
      addTag: (kind, tag) => storage.addKnownTag(kind, tag),
      setSetting: (key, value) => localStorage.setItem(key, value),
      tick: () => new Promise((r) => setTimeout(r, 0)),
    };
  }

  async function handleRestore() {
    if (!pending || busy) return;
    const { plan } = pending;
    breadcrumb(`backup: restoring (${plan.addEntries.length} add, ${plan.updateEntries.length} update, ${plan.themes.length}th ${plan.icons.length}ic ${plan.fonts.length}f)`);
    busy = "restoring";
    progress = { done: 0, total: planSize };
    try {
      const r = await applyRestore(plan, makeSink(), (done, total) => (progress = { done, total }));
      refresh();
      syncTags();
      // Reminders live in the phone's alarm clock, not in the file: set them again for what came back.
      for (const entry of [...plan.addEntries, ...plan.updateEntries]) {
        if ((entry.reminderAt || entry.reminderRepeat) && !entry.deletedAt) await syncReminderSilently(entry);
      }
      breadcrumb(`backup: restore done ${JSON.stringify(r)}`);
      report = { lines: describeReport(r), restart: r.settingsApplied > 0 };
      pending = null;
      pushToast({ title: "Restore finished", description: `${r.entriesAdded + r.entriesUpdated} item${r.entriesAdded + r.entriesUpdated === 1 ? "" : "s"} restored.` });
    } catch (err) {
      breadcrumb(`backup: restore failed (${err instanceof Error ? err.message : String(err)})`);
      notice = { kind: "error", text: "The restore stopped part-way. What was already restored is kept; you can run it again." };
    } finally {
      busy = null;
      progress = null;
    }
  }

  function cancelRestore() {
    breadcrumb("backup: restore cancelled");
    pending = null;
  }
</script>

<div class="backup">
  <p class="mine" aria-label="What a backup would contain">{mine || "Nothing to back up yet."}</p>
  <p class="last">Last backup: <strong>{when(lastBackup)}</strong></p>

  <SettingsRow
    label="Back up everything"
    desc="Save notes, todos, boards, themes, icons and fonts to one file."
    aria-label="Back up everything"
    onclick={handleBackup}
    value={busy === "backup" ? "Saving…" : ""}
    chevron={busy !== "backup"}
  />
  <SettingsRow
    label="Restore from a backup"
    desc="Merges a backup file into this phone. Nothing is deleted."
    aria-label="Restore from a backup"
    onclick={() => fileInput?.click()}
    value={busy === "reading" ? "Reading…" : ""}
    chevron={busy !== "reading"}
  />
  <input bind:this={fileInput} type="file" class="file-input" aria-label="Backup file" onchange={handlePicked} />

  <p class="warn">The backup file isn't encrypted: anyone who has it can read your unlocked notes. Locked notes stay locked inside it. Keep it somewhere private.</p>

  {#if notice}
    <p class="notice" class:error={notice.kind === "error"} role="alert">{notice.text}</p>
  {/if}

  {#if pending}
    <section class="card" aria-label="Restore preview">
      <h2>Restore this backup?</h2>
      <p class="line">Made {when(pending.backup.createdAt)}</p>
      <p class="line">
        Contains {[
          plural(pending.backup.counts.notes, "note"),
          plural(pending.backup.counts.todos, "todo"),
          plural(pending.backup.counts.boards, "board"),
          pending.backup.counts.trashed ? `${pending.backup.counts.trashed} in Trash` : "",
          pending.backup.counts.themes ? plural(pending.backup.counts.themes, "theme") : "",
          pending.backup.counts.icons ? plural(pending.backup.counts.icons, "icon") : "",
          pending.backup.counts.fonts ? plural(pending.backup.counts.fonts, "font") : "",
        ]
          .filter(Boolean)
          .join(" · ")}.
      </p>
      {#if planSize === 0}
        <p class="line strong">Nothing to restore — everything in this backup is already here.</p>
      {:else}
        <p class="line strong">
          {pending.plan.addEntries.length} to add · {pending.plan.updateEntries.length} to update · {pending.plan.keptEntries} already here
          {#if mediaToAdd > 0}
            · {mediaToAdd} theme/icon/font{mediaToAdd === 1 ? "" : "s"} to add
          {/if}
        </p>
        <p class="line">Where both copies exist, the newer one is kept. Nothing on this phone is deleted.</p>
      {/if}
      {#if pending.plan.invalidEntries > 0}
        <p class="line">{pending.plan.invalidEntries} item{pending.plan.invalidEntries === 1 ? "" : "s"} in the file can't be read and will be skipped.</p>
      {/if}
      {#if busy === "restoring" && progress}
        <p class="line progress" role="status">Restoring… {progress.done} / {progress.total}</p>
      {/if}
      <div class="actions">
        {#if planSize > 0 || Object.keys(pending.plan.settings).length > 0}
          <Button variant="default" onclick={handleRestore} disabled={busy !== null} aria-label="Restore backup">Restore</Button>
        {/if}
        <Button variant="ghost" onclick={cancelRestore} disabled={busy === "restoring"} aria-label="Cancel restore">{planSize === 0 ? "Close" : "Cancel"}</Button>
      </div>
    </section>
  {/if}

  {#if report}
    <section class="card" aria-label="Restore result">
      <h2>Restore finished</h2>
      {#each report.lines as line}
        <p class="line">{line}</p>
      {/each}
      {#if report.restart}
        <div class="actions">
          <Button variant="default" onclick={() => location.reload()} aria-label="Restart now">Restart now</Button>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .backup {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .mine,
  .last {
    margin: 0;
    font-size: 13px;
    color: var(--text-lo);
  }
  .last strong {
    color: var(--text-hi);
    font-weight: 600;
  }
  .file-input {
    display: none;
  }
  .warn {
    margin: 0;
    font-size: 12px;
    color: var(--text-faint);
  }
  .notice {
    margin: 0;
    font-size: 13px;
    color: var(--text-lo);
  }
  .notice.error {
    color: var(--danger, #e5645a);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-hi);
  }
  .line {
    margin: 0;
    font-size: 13px;
    color: var(--text-lo);
  }
  .line.strong {
    color: var(--text-hi);
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
