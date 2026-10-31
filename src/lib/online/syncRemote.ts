// Round C — the real server calls for sync (Supabase PostgREST), kept apart from the engine.
//
//   push:  POST rest/v1/rpc/midnote_push_entries   body {"p_entries":[{id,type,payload,last_modified,purged}...]}
//          -> [{entry_id, applied}]   (the function is in the database; see supabase/midnote-005-sync.sql)
//   pull:  GET  rest/v1/midnote_entries?select=...&order=updated_at.asc,id.asc&limit=N[&or=(...)]
//
// The pull filter is keyset paging on (updated_at, id). updated_at carries colons, dots and a
// "+" so its value goes in double quotes (PostgREST's rule for reserved characters) and the
// whole expression is then percent-encoded.
import { AuthError, type HttpResponse } from "$lib/online/authClient";
import { SyncError, type PullCursor, type PushResult, type PushRow, type RemoteRow, type SyncRemote } from "$lib/online/syncEngine";

export type RequestFn = (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

const SELECT = "id,type,payload,last_modified,purged,updated_at";

function quote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildPullPath(after: PullCursor | null, limit: number): string {
  const parts = [`select=${SELECT}`, "order=updated_at.asc,id.asc", `limit=${Math.max(1, Math.floor(limit))}`];
  if (after) {
    const t = quote(after.t);
    const expr = after.id === null ? `(updated_at.gt.${t})` : `(updated_at.gt.${t},and(updated_at.eq.${t},id.gt.${quote(after.id)}))`;
    parts.push(`or=${encodeURIComponent(expr)}`);
  }
  return `rest/v1/midnote_entries?${parts.join("&")}`;
}

interface ErrorBody {
  code: string;
  message: string;
}

function readError(text: string): ErrorBody {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    return { code: typeof j.code === "string" ? j.code : "", message: typeof j.message === "string" ? j.message : "" };
  } catch {
    return { code: "", message: "" };
  }
}

/** Turn a failed HTTP answer into the kind of failure the engine understands. */
export function classifyHttp(status: number, text: string): SyncError {
  const { code, message } = readError(text);
  const short = message.slice(0, 160);
  if (status === 401 || code === "28000" || code.startsWith("PGRST30")) return new SyncError("auth", short || "Not signed in");
  if (status === 429) return new SyncError("rate-limited", "Too many requests");
  if (status === 404 || code === "PGRST202" || code === "42P01") return new SyncError("server", "Sync isn't set up on the server yet");
  if (status === 408 || status >= 500) return new SyncError("server", short || `Server error ${status}`);
  if (code === "54000" && /storage limit|row limit|entry limit|too many rows/i.test(message)) return new SyncError("quota", short || "Storage limit reached");
  if (status >= 400) return new SyncError("rejected", short || `Refused (${status})`);
  return new SyncError("server", `Unexpected answer ${status}`);
}

export class RestSyncRemote implements SyncRemote {
  private request: RequestFn;
  constructor(request: RequestFn) {
    this.request = request;
  }

  private async call(path: string, init: { method?: string; body?: string }): Promise<string> {
    let res: HttpResponse;
    let text: string;
    try {
      res = await this.request(path, init);
      text = await res.text();
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.kind === "signed-out") throw new SyncError("auth", "Not signed in");
        throw new SyncError("network", "Can't reach the server");
      }
      throw new SyncError("network", "Can't reach the server");
    }
    if (res.status < 200 || res.status >= 300) throw classifyHttp(res.status, text);
    return text;
  }

  async push(rows: PushRow[]): Promise<PushResult[]> {
    const text = await this.call("rest/v1/rpc/midnote_push_entries", { method: "POST", body: JSON.stringify({ p_entries: rows }) });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SyncError("server", "The server's answer wasn't readable");
    }
    if (!Array.isArray(parsed)) throw new SyncError("server", "The server's answer wasn't readable");
    const out: PushResult[] = [];
    for (const r of parsed) {
      if (r && typeof r === "object" && typeof (r as PushResult).entry_id === "string" && typeof (r as PushResult).applied === "boolean") {
        out.push({ entry_id: (r as PushResult).entry_id, applied: (r as PushResult).applied });
      }
    }
    return out;
  }

  async pull(after: PullCursor | null, limit: number): Promise<RemoteRow[]> {
    const text = await this.call(buildPullPath(after, limit), { method: "GET" });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SyncError("server", "The server's answer wasn't readable");
    }
    if (!Array.isArray(parsed)) throw new SyncError("server", "The server's answer wasn't readable");
    const rows: RemoteRow[] = [];
    for (const r of parsed) {
      const o = r as Record<string, unknown>;
      if (!o || typeof o.id !== "string" || typeof o.type !== "string" || typeof o.last_modified !== "string" || typeof o.updated_at !== "string") {
        throw new SyncError("server", "The server sent a row this app can't read");
      }
      rows.push({ id: o.id, type: o.type, payload: o.payload, last_modified: o.last_modified, purged: o.purged === true, updated_at: o.updated_at });
    }
    return rows;
  }
}
