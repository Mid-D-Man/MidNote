// Round C — sync between devices, the part that decides things.
//
// PURE: no network, no storage, no Svelte. The caller hands in a `remote` (what the server
// does), a `local` (this phone's entries) and a place to keep the engine's own state, so the
// whole algorithm can be tested against a fake server that behaves like the real SQL function
// public.midnote_push_entries (supabase/midnote-005-sync.sql documents what it relies on).
//
// WHAT THE SERVER GUARANTEES (read from the real function, not assumed):
//   - a push row is applied only when its last_modified is STRICTLY newer than the stored one;
//     the answer per row is { entry_id, applied }
//   - one bad row (or the 20 MB quota check at the end) rolls back the WHOLE call
//   - a purged row (a tombstone) keeps no payload
//   - updated_at is the SERVER's clock and moves forward on every applied change
//
// THE RULES THIS ENGINE FOLLOWS
//   - newer lastModified wins, in both directions, per entry
//   - nothing is ever deleted unless the person did "Delete forever" (a tombstone), and a
//     tombstone loses to an edit that is newer than it
//   - an entry is "dirty" when its lastModified is newer than the one we last saw on the server
//   - pull first (so we don't push what the server already beats), then push, then pull again
//     only if the server refused something as already-newer
//   - a pull never skips a row: paging is by (updated_at, id) and every sync starts a little
//     BEFORE the saved position; a row this app can't read yet holds the saved position back
import type { Entry } from "$lib/types/entry";

export const SYNC_STATE_VERSION = 1;
export const ENVELOPE_VERSION = 1;
export const PUSH_BATCH_MAX = 50;
export const PUSH_BATCH_BYTES = 1_500_000;
export const PULL_PAGE = 100;
export const PAYLOAD_MAX_BYTES = 1_000_000;
export const PULL_OVERLAP_MS = 120_000;
export const MAX_REJECTS_PER_SYNC = 5;
const MAX_PAGES = 2000;

// ---------------------------------------------------------------------------- wire types

/** Where a pull continues from: the server's updated_at exactly as it sent it, plus the row id. */
export interface PullCursor {
  t: string;
  id: string | null;
}

export interface RemoteRow {
  id: string;
  type: string;
  payload: unknown;
  last_modified: string;
  purged: boolean;
  updated_at: string;
}

export interface PushRow {
  id: string;
  type: string;
  payload: unknown;
  last_modified: string;
  purged: boolean;
}

export interface PushResult {
  entry_id: string;
  applied: boolean;
}

export type SyncFailKind = "network" | "auth" | "server" | "quota" | "rejected" | "rate-limited";

export class SyncError extends Error {
  kind: SyncFailKind;
  constructor(kind: SyncFailKind, message: string) {
    super(message);
    this.name = "SyncError";
    this.kind = kind;
  }
}

export interface SyncRemote {
  /** Throws SyncError. `rejected` = the server refused THIS data (the whole call was rolled back). */
  push(rows: PushRow[]): Promise<PushResult[]>;
  /** Rows after the cursor in (updated_at, id) order, at most `limit`. Throws SyncError. */
  pull(after: PullCursor | null, limit: number): Promise<RemoteRow[]>;
}

export interface SyncLocal {
  /** Every entry, trash included. Fresh copies. */
  list(): Entry[];
  /** Save exactly as given (no lastModified bump). */
  upsert(entry: Entry): void | Promise<void>;
  /** Remove for good, locally only. */
  remove(id: string): void;
}

// ---------------------------------------------------------------------------- state

export interface SyncState {
  v: number;
  /** The account these marks belong to. */
  userId: string | null;
  /** Where the next pull continues (already safe to resume from). */
  cursor: PullCursor | null;
  /** id -> the lastModified we know the server holds (or holds something newer than). */
  marks: Record<string, string>;
  /** id -> a "Delete forever" still to be told to the server. */
  purges: Record<string, { at: string; type: string }>;
  /** id -> the lastModified the server refused (too big, bad date...). Skipped until it changes. */
  rejected: Record<string, string>;
  lastSyncAt: string | null;
}

export function emptyState(): SyncState {
  return { v: SYNC_STATE_VERSION, userId: null, cursor: null, marks: {}, purges: {}, rejected: {}, lastSyncAt: null };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/** Read a saved state defensively. Anything unrecognisable starts over (a fresh sync is always safe). */
export function parseState(raw: unknown): SyncState {
  if (!isRecord(raw) || raw.v !== SYNC_STATE_VERSION) return emptyState();
  const s = emptyState();
  s.userId = typeof raw.userId === "string" && raw.userId ? raw.userId : null;
  const c = raw.cursor;
  if (isRecord(c) && typeof c.t === "string" && c.t) s.cursor = { t: c.t, id: typeof c.id === "string" ? c.id : null };
  if (isRecord(raw.marks)) for (const [k, v] of Object.entries(raw.marks)) if (typeof v === "string") s.marks[k] = v;
  if (isRecord(raw.purges)) {
    for (const [k, v] of Object.entries(raw.purges)) {
      if (isRecord(v) && typeof v.at === "string" && typeof v.type === "string") s.purges[k] = { at: v.at, type: v.type };
    }
  }
  if (isRecord(raw.rejected)) for (const [k, v] of Object.entries(raw.rejected)) if (typeof v === "string") s.rejected[k] = v;
  s.lastSyncAt = typeof raw.lastSyncAt === "string" ? raw.lastSyncAt : null;
  return s;
}

// ---------------------------------------------------------------------------- time

const TIME_RE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/;

function splitTime(s: unknown): { base: string; frac: string; tz: string } | null {
  if (typeof s !== "string") return null;
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  let tz = m[3] ?? "Z";
  if (tz !== "Z") {
    const d = tz.slice(1).replace(":", "");
    tz = `${tz[0]}${d.slice(0, 2)}:${d.length > 2 ? d.slice(2, 4) : "00"}`;
    if (tz === "+00:00" || tz === "-00:00") tz = "Z";
  }
  return { base: m[1], frac: m[2] ?? "", tz };
}

/** Milliseconds since the epoch, NaN when it isn't a date. Postgres sends microseconds and
 *  an offset ("2026-10-28T10:00:00.123456+00:00"): the extra digits are dropped. No zone = UTC. */
export function parseTime(s: unknown): number {
  const p = splitTime(s);
  if (!p) return NaN;
  const ms = (p.frac + "000").slice(0, 3);
  return Date.parse(`${p.base}.${ms}${p.tz}`);
}

/** A string that sorts like the server's own updated_at (6 fraction digits, UTC). */
export function sortableTime(s: string): string {
  const p = splitTime(s);
  if (p && p.tz === "Z") return `${p.base}.${(p.frac + "000000").slice(0, 6)}Z`;
  const ms = parseTime(s);
  if (Number.isNaN(ms)) return s;
  return `${new Date(ms).toISOString().slice(0, 19)}.${(ms % 1000).toString().padStart(3, "0")}000Z`;
}

export function compareCursor(a: PullCursor, b: PullCursor): number {
  const ta = sortableTime(a.t);
  const tb = sortableTime(b.t);
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ia = a.id ?? "";
  const ib = b.id ?? "";
  return ia === ib ? 0 : ia < ib ? -1 : 1;
}

function shiftedBack(c: PullCursor | null): PullCursor | null {
  if (!c) return null;
  const ms = parseTime(c.t);
  if (Number.isNaN(ms)) return null;
  const earlier = new Date(ms - PULL_OVERLAP_MS).toISOString().slice(0, 23);
  return { t: `${earlier}000Z`, id: null };
}

// ---------------------------------------------------------------------------- envelope

export interface Envelope {
  v: number;
  enc: "none";
  entry: unknown;
}

/** What goes in the server's payload column. `enc` is the hook for encrypting entries later:
 *  an app that finds an `enc` it doesn't know leaves the row alone (see decodeRow). */
export function encodeEntry(entry: Entry): Envelope {
  return { v: ENVELOPE_VERSION, enc: "none", entry };
}

export type Decoded = { kind: "ok"; entry: Entry } | { kind: "newer" } | { kind: "bad" };

export function decodeRow(row: RemoteRow, normalize: (raw: unknown) => Entry | null): Decoded {
  const p = row.payload;
  if (!isRecord(p)) return { kind: "bad" };
  if (typeof p.v === "number" && p.v > ENVELOPE_VERSION) return { kind: "newer" };
  if (p.enc !== undefined && p.enc !== "none") return { kind: "newer" };
  if (p.v !== ENVELOPE_VERSION || !isRecord(p.entry)) return { kind: "bad" };
  if (p.entry.id !== row.id || p.entry.type !== row.type) return { kind: "bad" };
  let entry: Entry | null = null;
  try {
    entry = normalize(p.entry);
  } catch {
    entry = null;
  }
  if (!entry || entry.id !== row.id || entry.type !== row.type) return { kind: "bad" };
  return { kind: "ok", entry };
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// ---------------------------------------------------------------------------- retry timing

/** Wait before the next AUTOMATIC attempt after `failures` failures in a row: doubling from
 *  5 s up to 15 min, then spread over 50-100% of that so many phones never retry together. */
export function retryDelayMs(failures: number, random: () => number): number {
  const n = Math.max(1, Math.floor(failures));
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(n - 1, 12));
  return Math.round(base * (0.5 + 0.5 * random()));
}

/** How many changes are waiting to go up: edited-since-last-sync entries plus pending deletions.
 *  The same rule the push uses to decide what is dirty. */
export function countPending(entries: Entry[], state: SyncState): number {
  let n = Object.keys(state.purges).length;
  for (const e of entries) {
    const ms = parseTime(e.lastModified);
    if (Number.isNaN(ms) || state.rejected[e.id] === e.lastModified) continue;
    const mark = state.marks[e.id];
    if (mark === undefined || ms > parseTime(mark)) n++;
  }
  return n;
}

/** When the app may next start a sync on its own after a failed run. Signed out: not for an
 *  hour (a sign-in starts one anyway). Anything else: the doubling back-off above. */
export function nextAutoTime(kind: SyncFailKind | "stopped" | undefined, failures: number, now: number, random: () => number): number {
  if (kind === "auth" || kind === "stopped") return now + 60 * 60_000;
  return now + retryDelayMs(failures, random);
}

// ---------------------------------------------------------------------------- the run

export interface SyncDeps {
  remote: SyncRemote;
  local: SyncLocal;
  normalize(raw: unknown): Entry | null;
  saveState(s: SyncState): void;
  now(): number;
  /** The signed-in account. */
  userId: string;
  /** True when the person signed out (or the app is closing): stop at the next safe point. */
  shouldStop?(): boolean;
}

export interface SyncOptions {
  /** Take this phone's notes into this account although they were synced with another one. */
  adopt?: boolean;
}

export type SyncStatus = "ok" | "partial" | "failed" | "account-mismatch";

export interface SyncResult {
  status: SyncStatus;
  /** Entries sent and accepted. */
  pushed: number;
  /** "Delete forever" tombstones sent and accepted. */
  pushedPurges: number;
  /** Entries written to this phone. */
  pulled: number;
  /** Entries removed from this phone because they were deleted forever elsewhere. */
  removed: number;
  unchanged: number;
  /** Server rows this app could not read (damaged). */
  skipped: number;
  /** Server rows written by a newer version of the app (the saved position waits for an update). */
  heldBack: number;
  rejected: { id: string; reason: "too-big" | "bad-date" | "refused" }[];
  quota: boolean;
  changedLocal: boolean;
  /** Ids written / removed locally this run (for reminders, tags). */
  appliedIds: string[];
  removedIds: string[];
  error: { kind: SyncFailKind | "stopped"; message: string } | null;
}

function blank(): SyncResult {
  return {
    status: "ok",
    pushed: 0,
    pushedPurges: 0,
    pulled: 0,
    removed: 0,
    unchanged: 0,
    skipped: 0,
    heldBack: 0,
    rejected: [],
    quota: false,
    changedLocal: false,
    appliedIds: [],
    removedIds: [],
    error: null,
  };
}

function stopIfAsked(deps: SyncDeps): void {
  if (deps.shouldStop?.()) throw new SyncError("auth", "Signed out");
}

export async function runSync(deps: SyncDeps, state: SyncState, opts: SyncOptions = {}): Promise<SyncResult> {
  const res = blank();
  if (state.userId && state.userId !== deps.userId) {
    if (!opts.adopt) {
      res.status = "account-mismatch";
      return res;
    }
    // Another account's marks and pending deletions must never reach this one.
    state.cursor = null;
    state.marks = {};
    state.purges = {};
    state.rejected = {};
    state.lastSyncAt = null;
  }
  state.userId = deps.userId;
  deps.saveState(state);

  try {
    await pullAll(deps, state, res);
    const needsRepull = await pushAll(deps, state, res);
    if (needsRepull) await pullAll(deps, state, res);
    state.lastSyncAt = new Date(deps.now()).toISOString();
    deps.saveState(state);
    const problems = res.quota || res.rejected.length > 0 || res.skipped > 0 || res.heldBack > 0;
    res.status = problems ? "partial" : "ok";
  } catch (e) {
    deps.saveState(state);
    res.status = "failed";
    if (e instanceof SyncError) res.error = { kind: e.kind, message: e.message };
    else res.error = { kind: "server", message: e instanceof Error ? e.message : "Unexpected error" };
  }
  return res;
}

// ---------------------------------------------------------------------------- pull

type RowOutcome = "applied" | "removed" | "unchanged" | "kept-local" | "skipped" | "held";

async function pullAll(deps: SyncDeps, state: SyncState, res: SyncResult): Promise<void> {
  const local = new Map<string, Entry>();
  for (const e of deps.local.list()) local.set(e.id, e);

  let after: PullCursor | null = shiftedBack(state.cursor);
  let prev: PullCursor | null = after;
  let hold: { at: PullCursor | null } | null = null;
  let lastRow: PullCursor | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    stopIfAsked(deps);
    const rows = await deps.remote.pull(after, PULL_PAGE);
    for (const row of rows) {
      const out = await applyRow(row, deps, state, res, local);
      if (out === "unchanged") res.unchanged++;
      if (out === "held" && !hold) hold = { at: prev };
      prev = { t: row.updated_at, id: row.id };
      lastRow = prev;
    }
    // Save how far we got: the position of the last row, or the spot just before the first
    // row this app couldn't read (so a later, updated app still gets it).
    const candidate = hold ? hold.at : lastRow;
    if (candidate && (!state.cursor || compareCursor(candidate, state.cursor) > 0)) state.cursor = candidate;
    deps.saveState(state);

    if (rows.length < PULL_PAGE) break;
    const next: PullCursor = { t: rows[rows.length - 1].updated_at, id: rows[rows.length - 1].id };
    if (after && compareCursor(next, after) <= 0) break; // the server isn't moving forward: don't spin
    after = next;
  }
}

async function applyRow(row: RemoteRow, deps: SyncDeps, state: SyncState, res: SyncResult, local: Map<string, Entry>): Promise<RowOutcome> {
  const rowMs = parseTime(row.last_modified);
  if (typeof row.id !== "string" || !row.id || Number.isNaN(rowMs)) {
    res.skipped++;
    return "skipped";
  }
  const rowIso = new Date(rowMs).toISOString();
  const mine = local.get(row.id);

  // A "Delete forever" of mine that the server doesn't know yet: an edit newer than it wins,
  // otherwise my deletion stands (and goes out in the push).
  const pending = state.purges[row.id];
  if (pending) {
    if (parseTime(pending.at) < rowMs) delete state.purges[row.id];
    else return "kept-local";
  }

  if (row.purged === true) {
    if (!mine) {
      delete state.marks[row.id];
      return "unchanged";
    }
    if (parseTime(mine.lastModified) > rowMs) {
      state.marks[row.id] = rowIso; // my edit is newer than the deletion: it goes back up
      return "kept-local";
    }
    deps.local.remove(row.id);
    local.delete(row.id);
    delete state.marks[row.id];
    res.removed++;
    res.changedLocal = true;
    res.removedIds.push(row.id);
    return "removed";
  }

  const dec = decodeRow(row, deps.normalize);
  if (dec.kind === "newer") {
    res.heldBack++;
    return "held";
  }
  if (dec.kind === "bad") {
    res.skipped++;
    return "skipped";
  }
  const mineMs = mine ? parseTime(mine.lastModified) : -Infinity;
  const mineMsSafe = Number.isNaN(mineMs) ? -Infinity : mineMs;
  if (!mine || rowMs > mineMsSafe) {
    const entry = dec.entry;
    entry.lastModified = rowIso;
    await deps.local.upsert(entry);
    local.set(entry.id, entry);
    state.marks[row.id] = rowIso;
    delete state.rejected[row.id];
    res.pulled++;
    res.changedLocal = true;
    res.appliedIds.push(row.id);
    return "applied";
  }
  state.marks[row.id] = rowIso;
  return rowMs === mineMsSafe ? "unchanged" : "kept-local";
}

// ---------------------------------------------------------------------------- push

interface Outgoing {
  row: PushRow;
  size: number;
  tombstone: boolean;
}

function collectOutgoing(deps: SyncDeps, state: SyncState, res: SyncResult): Outgoing[] {
  const out: Outgoing[] = [];
  for (const entry of deps.local.list()) {
    // Brought back (restored from a backup, say) after "Delete forever": the entry wins and
    // goes up as an ordinary change, so the pending deletion is dropped.
    delete state.purges[entry.id];
    const lmMs = parseTime(entry.lastModified);
    if (Number.isNaN(lmMs)) {
      res.rejected.push({ id: entry.id, reason: "bad-date" });
      continue;
    }
    if (state.rejected[entry.id] === entry.lastModified) continue;
    const mark = state.marks[entry.id];
    if (mark !== undefined && lmMs <= parseTime(mark)) continue;
    const iso = new Date(lmMs).toISOString();
    const env = encodeEntry({ ...entry, lastModified: iso } as Entry);
    const size = utf8Length(JSON.stringify(env));
    if (size > PAYLOAD_MAX_BYTES) {
      state.rejected[entry.id] = entry.lastModified;
      res.rejected.push({ id: entry.id, reason: "too-big" });
      continue;
    }
    out.push({ row: { id: entry.id, type: entry.type, payload: env, last_modified: iso, purged: false }, size, tombstone: false });
  }
  for (const [id, p] of Object.entries(state.purges)) {
    const at = parseTime(p.at);
    if (Number.isNaN(at)) {
      delete state.purges[id];
      continue;
    }
    out.push({ row: { id, type: p.type, payload: {}, last_modified: new Date(at).toISOString(), purged: true }, size: 80, tombstone: true });
  }
  return out;
}

function chunk(items: Outgoing[]): Outgoing[][] {
  const batches: Outgoing[][] = [];
  let cur: Outgoing[] = [];
  let bytes = 0;
  for (const it of items) {
    if (cur.length > 0 && (cur.length >= PUSH_BATCH_MAX || bytes + it.size > PUSH_BATCH_BYTES)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += it.size;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** Returns true when the server refused something as already newer (a second pull will fetch it). */
async function pushAll(deps: SyncDeps, state: SyncState, res: SyncResult): Promise<boolean> {
  const batches = chunk(collectOutgoing(deps, state, res));
  const ctx = { needsRepull: false, rejects: 0 };
  try {
    for (const batch of batches) {
      stopIfAsked(deps);
      await pushBatch(batch, deps, state, res, ctx);
    }
  } catch (e) {
    if (e instanceof SyncError && e.kind === "quota") res.quota = true;
    else throw e;
  }
  return ctx.needsRepull;
}

async function pushBatch(batch: Outgoing[], deps: SyncDeps, state: SyncState, res: SyncResult, ctx: { needsRepull: boolean; rejects: number }): Promise<void> {
  let results: PushResult[];
  try {
    results = await deps.remote.push(batch.map((b) => b.row));
  } catch (e) {
    if (e instanceof SyncError && e.kind === "rejected") {
      if (batch.length === 1) {
        const only = batch[0];
        if (!only.tombstone) state.rejected[only.row.id] = only.row.last_modified;
        res.rejected.push({ id: only.row.id, reason: "refused" });
        deps.saveState(state);
        if (++ctx.rejects >= MAX_REJECTS_PER_SYNC) throw new SyncError("server", "The server refused several entries");
        return;
      }
      const mid = Math.floor(batch.length / 2);
      await pushBatch(batch.slice(0, mid), deps, state, res, ctx);
      await pushBatch(batch.slice(mid), deps, state, res, ctx);
      return;
    }
    throw e;
  }
  const answered = new Map<string, boolean>();
  for (const r of results) answered.set(r.entry_id, r.applied === true);
  for (const b of batch) {
    const id = b.row.id;
    const applied = answered.get(id);
    if (applied === true) {
      if (b.tombstone) {
        delete state.purges[id];
        delete state.marks[id];
        res.pushedPurges++;
      } else {
        state.marks[id] = b.row.last_modified;
        delete state.rejected[id];
        res.pushed++;
      }
    } else if (applied === false) {
      // The server already holds this or something newer: the next pull settles it.
      if (b.tombstone) delete state.purges[id];
      ctx.needsRepull = true;
    }
  }
  deps.saveState(state);
}
