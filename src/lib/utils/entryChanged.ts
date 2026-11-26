// Did an entry change since the editor opened it (or since the last time it said "Saved")? Used so that leaving an editor says
// "Saved" only when something really was saved that the person hasn't already been told about: an entry that was just looked at
// says nothing, and so does one that was saved with the Save button a moment ago.
//
// The editors keep a snapshot of the entry when they open it and compare against it. A snapshot is the entry as text; the time of
// the last change is left out, because saving sets it.

export function snapshotOf(entry: unknown): string {
  try {
    return JSON.stringify(entry, (k, v) => (k === "lastModified" ? undefined : v)) ?? "";
  } catch {
    return "";
  }
}

/** Is `current` different from the snapshot? No snapshot (a new entry) or an unreadable one counts as changed. */
export function changedSince(snapshot: string | null, current: unknown): boolean {
  if (snapshot === null || snapshot === "") return true;
  const now = snapshotOf(current);
  return now === "" || now !== snapshot;
}
