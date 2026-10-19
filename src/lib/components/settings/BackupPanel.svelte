<script lang="ts">
  // Round 45 — Settings -> Backup & restore.
  //
  //   Back up everything   one .mdix file (plain DixScript text): notes, todos, boards (and Trash),
  //                        tags, themes, icons, imported fonts and look-and-feel settings
  //                        (utils/backup.ts + backupMdix.ts have the format and its rules).
  //                        With "Protect with a password" it saves midnote-backup-DATE.mdix.enc and
  //                        its key file midnote-backup-DATE.mdix.key instead (utils/backupFiles.ts).
  //   Restore from a file  reads a backup (.mdix, .mdix.enc + key file, or an older .json), SHOWS what
  //                        it would do, and only then merges it in: nothing on the phone is deleted,
  //                        a newer copy wins, locked notes stay locked
  //
  // Saving goes through downloadFiles() — the Android-safe save dialog. Picking files uses a plain
  // <input type="file" multiple> with NO accept filter (Android's picker hides unknown extensions that
  // way, same lesson as the font picker); an encrypted backup and its key file are picked together, and
  // files are recognised by their content, not their names.
  import SettingsRow from "./SettingsRow.svelte";
  import Button from "$lib/components/ui/Button/Button.svelte";
  import Switch from "$lib/components/ui/Switch/Switch.svelte";
  import { askPassword } from "$lib/stores/lockPrompt.svelte";
  import { beginGlobalBusy, endGlobalBusy } from "$lib/stores/globalBusy.svelte";
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
  import { classifyPicked, cryptoAvailable, makeBackupFiles, openClassified, type Classified, type PickedFile } from "$lib/utils/backupFiles";
  import {
    applyRestore,
    base64ToBytes,
    buildBackup,
    countEntries,
    describeReport,
    parseBackup,
    planRestore,
    type BackupFile,
    type RestorePlan,
    type RestoreSink,
  } from "$lib/utils/backup";
  import type { FontKind } from "$lib/utils/fonts";

  const LAST_BACKUP_KEY = "midnote:last-backup";

  let fileInput = $state<HTMLInputElement | null>(null);
  let keyInput = $state<HTMLInputElement | null>(null);
  let protect = $state(false);
  // an encrypted backup was picked without its key file: it waits here for the key
  let waiting = $state<{ enc: Uint8Array } | null>(null);
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
      counts.folders ? plural(counts.folders, "folder") : "",
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
      let password: string | undefined;
      if (protect) {
        if (!cryptoAvailable()) {
          notice = { kind: "error", text: "Password protection only works in the installed app." };
          return;
        }
        const p = await askPassword(
          "Protect this backup",
          "You'll need this password, and the key file saved with the backup, to restore it. The password can't be recovered.",
          true
        );
        if (p === null) {
          breadcrumb("backup: password prompt cancelled");
          return;
        }
        password = p;
      }
      if (password) beginGlobalBusy("Encrypting…");
      let out;
      try {
        out = await makeBackupFiles(file, { password });
      } finally {
        if (password) endGlobalBusy();
      }
      const total = out.reduce((n, f) => n + f.bytes.length, 0);
      const saved = await downloadFiles(out.map((f) => ({ name: f.name, blob: new Blob([f.bytes as BlobPart], { type: f.type }) })));
      if (saved > 0) {
        const iso = new Date().toISOString();
        try {
          localStorage.setItem(LAST_BACKUP_KEY, iso);
        } catch {
          /* not worth failing the backup over */
        }
        lastBackup = iso;
        breadcrumb(`backup: saved ${out.length} file${out.length === 1 ? "" : "s"} ${formatSize(total)}${password ? " (encrypted)" : ""} (${file.counts.notes}n ${file.counts.todos}t ${file.counts.boards}b ${file.counts.themes}th ${file.counts.icons}ic ${file.counts.fonts}f)`);
        if (saved < out.length) {
          pushToast({ title: "Only part of the backup was saved", description: "A password-protected backup needs both the .mdix.enc file and its .mdix.key file. Back up again and save both." });
        } else {
          pushToast({ title: "Backup saved", description: password ? `${formatSize(total)} — keep the backup AND its key file, and remember the password.` : `${formatSize(total)} — keep it somewhere safe.` });
        }
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

  async function readPicked(list: File[]): Promise<PickedFile[]> {
    return Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  }

  /** Asks for the password (again, if it was wrong) and opens an encrypted backup. Null = cancelled or failed (notice set). */
  async function openWithPassword(c: Classified): Promise<BackupFile | null> {
    let error: string | null = null;
    for (;;) {
      const p = await askPassword("Backup password", "Enter the password this backup was saved with.", false, error);
      if (p === null) {
        breadcrumb("backup: password prompt cancelled");
        return null;
      }
      beginGlobalBusy("Unlocking…");
      let r;
      try {
        r = await openClassified(c, p);
      } finally {
        endGlobalBusy();
      }
      if (r.ok) return r.backup;
      if ("wrongPassword" in r) {
        breadcrumb("backup: wrong password or key file");
        error = "Wrong password, or this key file belongs to a different backup. Try again.";
        continue;
      }
      notice = { kind: "error", text: r.message };
      return null;
    }
  }

  /** What was picked -> a restore preview. */
  async function openFiles(files: PickedFile[]) {
    const c = classifyPicked(files);
    breadcrumb(`backup: picked ${files.length} file${files.length === 1 ? "" : "s"} -> ${c.kind}${c.kind === "encrypted" ? (c.key === null ? " (no key file)" : " (with key file)") : ""}`);
    if (c.kind === "encrypted" && c.key === null) {
      waiting = { enc: c.enc };
      return;
    }
    let backup: BackupFile | null;
    if (c.kind === "encrypted") {
      if (!cryptoAvailable()) {
        notice = { kind: "error", text: "Opening a password-protected backup only works in the installed app." };
        return;
      }
      backup = await openWithPassword(c);
    } else {
      const r = await openClassified(c, null);
      if (!r.ok) {
        notice = { kind: "error", text: r.message };
        return;
      }
      backup = r.backup;
    }
    if (!backup) return;
    pending = { backup, plan: planRestore(backup, snapshot(), storage.normalizeEntry) };
  }

  async function handlePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = ""; // so picking the same file again still fires
    if (picked.length === 0 || busy) return;
    breadcrumb(`backup: restore picked ${picked.length} file${picked.length === 1 ? "" : "s"} (${formatSize(picked.reduce((n, f) => n + f.size, 0))})`);
    busy = "reading";
    notice = null;
    report = null;
    pending = null;
    waiting = null;
    try {
      await openFiles(await readPicked(picked));
    } catch (err) {
      breadcrumb(`backup: couldn't read the picked file (${err instanceof Error ? err.message : String(err)})`);
      notice = { kind: "error", text: "Couldn't read that file." };
    } finally {
      busy = null;
    }
  }

  async function handleKeyPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = "";
    if (picked.length === 0 || busy || !waiting) return;
    const enc = waiting.enc;
    busy = "reading";
    notice = null;
    try {
      const files = await readPicked(picked);
      waiting = null;
      await openFiles([{ name: "backup.mdix.enc", bytes: enc }, ...files]);
    } catch (err) {
      breadcrumb(`backup: couldn't read the key file (${err instanceof Error ? err.message : String(err)})`);
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
  <SettingsRow label="Protect with a password" desc="Saves an encrypted .mdix.enc backup plus its .mdix.key key file. Keep both, and remember the password.">
    <Switch bind:checked={protect} aria-label="Protect backup with a password" />
  </SettingsRow>
  <SettingsRow
    label="Restore from a backup"
    desc="Merges a backup into this phone. Nothing is deleted. For an encrypted backup, pick its .mdix.enc and .mdix.key files together."
    aria-label="Restore from a backup"
    onclick={() => fileInput?.click()}
    value={busy === "reading" ? "Reading…" : ""}
    chevron={busy !== "reading"}
  />
  <input bind:this={fileInput} type="file" multiple class="file-input" aria-label="Backup file" onchange={handlePicked} />
  <input bind:this={keyInput} type="file" class="file-input" aria-label="Key file" onchange={handleKeyPicked} />

  <p class="warn">A plain .mdix backup isn't encrypted: anyone who has it can read your unlocked notes. Turn on "Protect with a password" for an encrypted copy. Locked notes stay locked inside either kind. Keep backups somewhere private.</p>

  {#if notice}
    <p class="notice" class:error={notice.kind === "error"} role="alert">{notice.text}</p>
  {/if}

  {#if waiting}
    <section class="card" aria-label="Key file needed">
      <h2>Key file needed</h2>
      <p class="line">This backup is encrypted. Pick the key file that was saved with it (it ends in .mdix.key).</p>
      <div class="actions">
        <Button variant="default" onclick={() => keyInput?.click()} disabled={busy !== null} aria-label="Pick key file">Pick key file</Button>
        <Button variant="ghost" onclick={() => (waiting = null)} aria-label="Cancel key file">Cancel</Button>
      </div>
    </section>
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
          pending.backup.counts.folders ? plural(pending.backup.counts.folders, "folder") : "",
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
