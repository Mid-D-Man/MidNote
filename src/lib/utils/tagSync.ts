// Unused-tags sync, part 2: the rules. Plain TypeScript, no stores, no network: tested in Node.
//
// THE PROBLEM: a tag that is on a note, todo or board travels inside that item. A tag that nothing uses yet (added in
// Settings -> Tags, or kept after its last item was deleted) lives only in the phone's tag list, which is not an item, so
// it never reached the other phones.
//
// THE RULE: the tag list travels as ONE extra setting, `midnote:known-tags`, through the same call as the other settings
// (utils/settingsSync.ts). Its value is { notes: { "Team": [when, 1] }, todos: {...}, boards: {...} } where 1 = "in the
// list" and 0 = "taken out" (a tombstone). Phones merge it TAG BY TAG: for each tag the newer mark wins (a tie keeps
// the tag), so two phones that each added a different tag both keep both, and a tag one phone removed stays removed on the
// others. Merging is the same whichever phone does it first, so phones end up with the same list whatever the order.
//
// The server only keeps a whole value with a newer stamp than the one it holds, so this phone's FIRST send carries stamp 1:
// it can only fill an empty spot and can never overwrite what another phone left there. The server's answer is merged with
// this phone's list, and when that is not what the server holds this phone sends once more with a newer stamp: the server
// then holds the union, whichever phones synced before.
//
// The built-in tags (AI Generated, Example) are never stored or synced. Everything that comes back is untrusted: names are
// checked like typed names (utils/tagNames.ts) and the size is capped.
import { isSystemTag } from "$lib/utils/systemTags";
import { cleanTagName } from "$lib/utils/tagNames";
import { TAG_SCOPES, emptyMarks, newDict, readMark, type TagMark, type TagMarks, type TagScopeName } from "$lib/utils/tagStamps";

/** The name this value goes under on the server (the SQL accepts it; its size limit for this one key is 20000 characters). */
export const TAGS_WIRE_KEY = "midnote:known-tags";
export const MAX_TAG_VALUE_CHARS = 20000;
/** Marks sent at most (tags in the lists plus removals still remembered). Past this the oldest removals go first, then the oldest tags. */
export const MAX_TAGS = 400;
/** Nothing is read from a server answer past this many marks (a bad answer cannot make the phone work for long). */
export const MAX_READ_MARKS = 4 * MAX_TAGS;
/** A removal is remembered this long, so a phone that was off for weeks still learns of it. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** A stamp this far ahead of this phone's clock is treated as "now": one phone with a wrong clock must not win forever. */
export const FUTURE_SLACK_MS = 5 * 60 * 1000;

export type Registry = Record<TagScopeName, string[]>;
export type WireEntry = { v: string; t: number };

/** A name the sync will carry: as a person would type it (no stray spaces, 1..40 characters) and not a built-in tag. */
export function validTagName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && cleanTagName(name) === name && !isSystemTag(name);
}

/** This phone's list as marks: every tag in the list is "present" (stamp from the marks, or 1 when it has none), and the
 *  removals still remembered are "gone". The list itself is the truth about what is present here. */
export function localMarks(registry: Registry, marks: TagMarks, now: number): TagMarks {
  const out = emptyMarks();
  for (const scope of TAG_SCOPES) {
    const inList = new Set<string>();
    for (const tag of registry[scope] ?? []) {
      if (!validTagName(tag)) continue;
      inList.add(tag);
      const m = marks[scope][tag];
      // no mark: it was there before this feature (1). A "removed" mark on a tag that IS in the list means it was added
      // back by a path that did not mark it: the list wins, one tick after its own removal.
      out[scope][tag] = !m ? [1, 1] : m[1] === 1 ? [m[0], 1] : [m[0] + 1, 1];
    }
    for (const tag of Object.keys(marks[scope])) {
      const m = marks[scope][tag];
      if (m[1] !== 0 || inList.has(tag) || !validTagName(tag)) continue;
      if (now - m[0] > TOMBSTONE_TTL_MS) continue;
      out[scope][tag] = [m[0], 0];
    }
  }
  return out;
}

function better(a: TagMark | undefined, b: TagMark | undefined): TagMark | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a[0] !== b[0]) return a[0] > b[0] ? a : b;
  return a[1] >= b[1] ? a : b; // same stamp: the tag stays
}

/** Tag by tag, the newer mark wins. Symmetric: mergeMarks(a, b) and mergeMarks(b, a) are the same. */
export function mergeMarks(a: TagMarks, b: TagMarks): TagMarks {
  const out = emptyMarks();
  for (const scope of TAG_SCOPES) {
    const names = new Set<string>([...Object.keys(a[scope]), ...Object.keys(b[scope])]);
    for (const name of names) {
      const m = better(a[scope][name], b[scope][name]);
      if (m) out[scope][name] = [m[0], m[1]];
    }
  }
  return out;
}

/** Forget removals older than the time limit. */
export function pruneMarks(marks: TagMarks, now: number): TagMarks {
  const out = emptyMarks();
  for (const scope of TAG_SCOPES) {
    for (const name of Object.keys(marks[scope])) {
      const m = marks[scope][name];
      if (m[1] === 0 && now - m[0] > TOMBSTONE_TTL_MS) continue;
      out[scope][name] = [m[0], m[1]];
    }
  }
  return out;
}

export function countMarks(marks: TagMarks): number {
  let n = 0;
  for (const scope of TAG_SCOPES) n += Object.keys(marks[scope]).length;
  return n;
}

/** The newest stamp in `marks` (0 when there are none). */
export function maxStamp(marks: TagMarks): number {
  let t = 0;
  for (const scope of TAG_SCOPES) for (const name of Object.keys(marks[scope])) t = Math.max(t, marks[scope][name][0]);
  return t;
}

type Item = { scope: TagScopeName; name: string; mark: TagMark };

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function textOf(items: readonly Item[]): string {
  const sorted = [...items].sort((x, y) => compareNames(x.name, y.name));
  const o: Record<string, Record<string, TagMark>> = {};
  for (const scope of TAG_SCOPES) {
    const d = newDict();
    let any = false;
    for (const it of sorted) {
      if (it.scope !== scope) continue;
      d[it.name] = it.mark;
      any = true;
    }
    if (any) o[scope] = d;
  }
  return JSON.stringify(o);
}

/** The text to send for `marks`, always the same text for the same marks (names sorted). When there are too many marks or
 *  the text is too long, the oldest removals are left out first, then the oldest tags; `dropped` counts those. */
export function toTagWire(marks: TagMarks): { text: string; dropped: number } {
  const items: Item[] = [];
  for (const scope of TAG_SCOPES) for (const name of Object.keys(marks[scope])) items.push({ scope, name, mark: marks[scope][name] });
  // the order they would be dropped in: removals first, oldest first
  const order = [...items].sort((x, y) => {
    if (x.mark[1] !== y.mark[1]) return x.mark[1] - y.mark[1];
    if (x.mark[0] !== y.mark[0]) return x.mark[0] - y.mark[0];
    return x.scope < y.scope ? -1 : x.scope > y.scope ? 1 : compareNames(x.name, y.name);
  });
  const dropped = new Set<Item>();
  let keep = items.length;
  while (keep > MAX_TAGS) {
    dropped.add(order[dropped.size]);
    keep--;
  }
  let text = textOf(items.filter((i) => !dropped.has(i)));
  while (text.length > MAX_TAG_VALUE_CHARS && dropped.size < order.length) {
    dropped.add(order[dropped.size]);
    text = textOf(items.filter((i) => !dropped.has(i)));
  }
  return { text, dropped: dropped.size };
}

/** The marks in a received value, checked: unknown lists and bad names or marks are ignored, stamps are clamped to now. */
export function fromTagWire(text: unknown, now: number): TagMarks {
  const out = emptyMarks();
  if (typeof text !== "string" || text.length > MAX_TAG_VALUE_CHARS) return out;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return out;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  let read = 0;
  for (const scope of TAG_SCOPES) {
    const d = (o as Record<string, unknown>)[scope];
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    for (const name of Object.keys(d)) {
      if (++read > MAX_READ_MARKS) return out;
      if (!validTagName(name)) continue;
      const m = readMark((d as Record<string, unknown>)[name]);
      if (!m) continue;
      out[scope][name] = [Math.min(m[0], now + FUTURE_SLACK_MS), m[1]];
    }
  }
  return out;
}

export interface TagPlan {
  add: Array<[TagScopeName, string]>;
  remove: Array<[TagScopeName, string]>;
}

/** What to change in this phone's list so that it matches `merged`. */
export function planApply(merged: TagMarks, registry: Registry): TagPlan {
  const plan: TagPlan = { add: [], remove: [] };
  for (const scope of TAG_SCOPES) {
    const have = new Set(registry[scope] ?? []);
    for (const name of Object.keys(merged[scope])) {
      const present = merged[scope][name][1] === 1;
      if (present && !have.has(name)) plan.add.push([scope, name]);
      else if (!present && have.has(name)) plan.remove.push([scope, name]);
    }
  }
  return plan;
}

export interface TagSyncDeps {
  loadRegistry(): Registry;
  loadMarks(): TagMarks;
  saveMarks(marks: TagMarks): void;
  /** Put the tag in the list WITHOUT marking it as changed here (the merged marks are saved right after). */
  addTag(scope: TagScopeName, tag: string): void;
  removeTag(scope: TagScopeName, tag: string): void;
  /** Called once after the list changed, so the app re-reads it. */
  onApplied(): void;
}

export interface TagPrepared {
  local: TagMarks;
  /** What to send with the settings (stamp 1: see the top of this file), or null when this phone has no tags and no removals to tell about. */
  wire: WireEntry | null;
}

/** Before the exchange: this phone's list as marks, and the value to send. */
export function prepareTags(deps: TagSyncDeps, now: number): TagPrepared {
  const local = localMarks(deps.loadRegistry(), deps.loadMarks(), now);
  if (countMarks(local) === 0) return { local, wire: null };
  return { local, wire: { v: toTagWire(local).text, t: 1 } };
}

export interface TagFinish {
  added: number;
  removed: number;
  /** Marks that did not fit in what is sent (very many tags). */
  dropped: number;
  /** When this phone's merged list is not what the server answered: the value to send once more. */
  resend: WireEntry | null;
}

function numberOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** After the exchange: merge what came back into this phone's list and say whether the server needs the result. */
export function finishTags(deps: TagSyncDeps, local: TagMarks, answer: unknown, now: number, pullOnly: boolean): TagFinish {
  let remoteMarks = emptyMarks();
  let remoteT = 0;
  let remoteText: string | null = null; // exactly what the server holds (not cleaned up), to see whether it needs ours
  if (answer && typeof answer === "object" && !Array.isArray(answer)) {
    const e = (answer as Record<string, unknown>)[TAGS_WIRE_KEY];
    if (e && typeof e === "object") {
      remoteT = numberOrZero((e as Record<string, unknown>).t);
      const v = (e as Record<string, unknown>).v;
      remoteText = typeof v === "string" ? v : null;
      remoteMarks = fromTagWire(v, now);
    }
  }
  const merged = pruneMarks(mergeMarks(local, remoteMarks), now);
  const plan = planApply(merged, deps.loadRegistry());
  for (const [scope, tag] of plan.add) deps.addTag(scope, tag);
  for (const [scope, tag] of plan.remove) deps.removeTag(scope, tag);
  deps.saveMarks(merged);
  if (plan.add.length + plan.remove.length > 0) deps.onApplied();
  let resend: WireEntry | null = null;
  let dropped = 0;
  if (!pullOnly && countMarks(merged) > 0) {
    const mine = toTagWire(merged);
    dropped = mine.dropped;
    // compared with what the server holds as it is, so a value this phone had to clean up (a stamp from a wrong clock, a
    // name that is not allowed) is replaced by the cleaned one
    if (mine.text !== remoteText) resend = { v: mine.text, t: Math.max(now, maxStamp(merged), remoteT + 1) };
  }
  return { added: plan.add.length, removed: plan.remove.length, dropped, resend };
}

/** Did the server keep `sent`? (It is also fine when someone else's newer list is there instead: the next sync merges it.) */
export function serverKept(answer: unknown, sent: WireEntry): boolean {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
  const e = (answer as Record<string, unknown>)[TAGS_WIRE_KEY];
  if (!e || typeof e !== "object") return false;
  const t = numberOrZero((e as Record<string, unknown>).t);
  const v = (e as Record<string, unknown>).v;
  return t > sent.t || (t === sent.t && v === sent.v);
}
