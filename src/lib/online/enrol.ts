// Round B — register the signed-in person as a MidNote user in the shared MidManStudio
// project, so MidNote shows up in the accounts portal next to the studio's other apps.
//
//   1. services?slug=eq.midnote            -> the service row (created by midnote-002-register-service.sql)
//   2. service_subscriptions?user_id&service_id   -> already enrolled? done
//   3. POST service_subscriptions {user_id, service_id, status:'active', tier:'free'}
//
// The columns are the ones the portal's own types use (profiles/services/
// service_subscriptions in mms-accounts). The table's Row Level Security policies were
// never visible from here, so this is BEST EFFORT by design: whatever happens, the caller
// treats it as a footnote. It never throws, never blocks sign-in, and a refusal is just
// an outcome the debug log can show.
import type { AuthClient } from "./authClient";

export type EnrolOutcome = "enrolled" | "already" | "no-service" | "denied" | "error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Requester = Pick<AuthClient, "request">;

async function readRows(res: { status: number; text(): Promise<string> }): Promise<unknown[] | null> {
  if (res.status < 200 || res.status >= 300) return null;
  try {
    const v: unknown = JSON.parse(await res.text());
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export async function ensureMidNoteEnrolment(client: Requester, userId: string): Promise<EnrolOutcome> {
  // The id goes into a URL: only a real UUID is allowed through.
  if (!UUID.test(userId)) return "error";
  try {
    const svcRes = await client.request("rest/v1/services?slug=eq.midnote&select=id&limit=1");
    if (svcRes.status === 401 || svcRes.status === 403) return "denied";
    const svc = await readRows(svcRes);
    if (svc === null) return "error";
    const first = svc[0] as { id?: unknown } | undefined;
    if (!first || (typeof first.id !== "string" && typeof first.id !== "number")) return "no-service";
    const serviceId = first.id;

    const subRes = await client.request(
      `rest/v1/service_subscriptions?user_id=eq.${userId}&service_id=eq.${encodeURIComponent(String(serviceId))}&select=id&limit=1`,
    );
    if (subRes.status === 401 || subRes.status === 403) return "denied";
    const subs = await readRows(subRes);
    if (subs === null) return "error";
    if (subs.length > 0) return "already";

    const ins = await client.request("rest/v1/service_subscriptions", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, service_id: serviceId, status: "active", tier: "free" }),
    });
    if (ins.status >= 200 && ins.status < 300) return "enrolled";
    if (ins.status === 409) return "already"; // a unique constraint: someone (another device) got there first
    if (ins.status === 401 || ins.status === 403) return "denied";
    return "error";
  } catch {
    // signed out mid-way, offline, or a malformed reply: all just "didn't happen this time"
    return "error";
  }
}
