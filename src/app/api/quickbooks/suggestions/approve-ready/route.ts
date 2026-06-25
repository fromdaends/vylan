// Bulk-approve every READY QuickBooks draft (Stage 4, Phase 4) via a STABLE URL
// endpoint (deploy-skew-proof, like the per-file /status route). "Ready" = a
// draft that is complete (no missing vendor/account/tax/total). Optionally scoped
// to one client.
//
// Still READ-ONLY on QuickBooks: this only flips status to 'approved'; nothing is
// posted (Stage 5). The server RECOMPUTES the ready set from fresh, RLS-scoped
// data — it never trusts a client-supplied list — so it approves exactly what is
// genuinely ready right now (and each can be reopened individually).

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { listFirmDrafts, setDraftStatus } from "@/lib/db/quickbooks-suggestions";
import { draftQueueBucket } from "@/lib/quickbooks/draft-queue";
import { logUserActivity } from "@/lib/db/activity";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  // Optional client filter. A malformed body is fine — it just means "all".
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const client =
    typeof body.client === "string" && body.client ? body.client : null;

  // Recompute the ready set from RLS-scoped data (the authorization + the truth).
  const rows = await listFirmDrafts();
  const ready = rows.filter(
    (r) =>
      draftQueueBucket({
        suggestion: r.suggestion,
        resolved: r.resolved,
        status: r.status,
      }) === "ready" &&
      (!client || r.clientId === client),
  );

  if (ready.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const results = await Promise.all(
    ready.map((r) =>
      setDraftStatus({
        uploadedFileId: r.fileId,
        status: "approved",
        reviewerId: auth.user.id,
      }),
    ),
  );
  const count = results.filter(Boolean).length;

  // Bust the cache for the queue + each touched engagement, both locales, the
  // moment the writes land — never hinge it on the best-effort audit log below.
  const engagementIds = [...new Set(ready.map((r) => r.engagementId))];
  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/quickbooks/drafts`);
    for (const eid of engagementIds) {
      revalidatePath(`/${loc}/engagements/${eid}`);
    }
  }

  // Audit trail (best-effort: one firm-level entry for the batch).
  try {
    const user = await getCurrentUser();
    if (user?.firm_id) {
      await logUserActivity(user.firm_id, null, "bulk_approve_qbo_drafts", {
        count,
        client,
      });
    }
  } catch (err) {
    console.error("[qbo approve-ready] audit log failed (approvals applied):", err);
  }

  return NextResponse.json({ ok: true, count });
}
