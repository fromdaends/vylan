// Client portal activity logging (unauthenticated write path).
//
// The portal is reachable by anyone holding the magic link, so this endpoint is
// deliberately narrow:
//   * magic token -> exactly one engagement (shape + expiry + not cancelled)
//   * action must be in a server-side allowlist (no arbitrary audit rows)
//   * metadata is reduced to two bounded strings (no log bloat / injection)
//   * rate-limited per token in its OWN bucket, so view spam can't starve real
//     portal writes (uploads, messages)
//   * logging failures never surface to the client (best-effort)
//
// It records what the client DOES in the portal (opens it, moves between
// sections, views/downloads a final document) as actor_type "client", so the
// accountant's Activity feed + the /settings/audit log show the full picture.

import { NextResponse, type NextRequest } from "next/server";
import { findEngagementForToken, logActivity } from "@/lib/db/portal";
import {
  checkRateLimit,
  PORTAL_ACTIVITY_PER_TOKEN,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// Keep in sync with PortalActivityAction in lib/portal/activity-log.ts.
const ALLOWED_ACTIONS = new Set([
  "client_viewed_portal",
  "client_opened_documents",
  "client_opened_signatures",
  "client_opened_messages",
  "client_opened_signature",
  "client_downloaded_deliverable",
]);

// Store at most these two keys, each a bounded trimmed string. Anything else the
// caller sends is dropped, so a malicious payload can't bloat the log or smuggle
// structured data into the audit trail.
function sanitizeMetadata(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  if (typeof src.name === "string" && src.name.trim()) {
    out.name = src.name.trim().slice(0, 200);
  }
  if (typeof src.ref === "string" && src.ref.trim()) {
    out.ref = src.ref.trim().slice(0, 64);
  }
  return out;
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const token = json?.token;
  const action = json?.action;
  if (typeof token !== "string" || typeof action !== "string") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const rl = await checkRateLimit({
    key: `portal:activity:token:${token}`,
    ...PORTAL_ACTIVITY_PER_TOKEN,
  });
  if (!rl.ok) {
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (rl.retryAfter) res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }

  const engagement = await findEngagementForToken(token);
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Best-effort: a logging failure must never break the portal experience.
  try {
    await logActivity(
      engagement.firm_id,
      engagement.id,
      action,
      sanitizeMetadata(json?.metadata),
    );
  } catch (e) {
    console.error("[portal activity] log failed:", e);
  }

  return NextResponse.json({ ok: true });
}
