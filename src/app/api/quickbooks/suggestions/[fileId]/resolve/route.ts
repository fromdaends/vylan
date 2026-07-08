// Save the accountant's pick for one field of a QuickBooks draft (Stage 4,
// Phase 1) via a STABLE URL endpoint (deploy-skew-proof, like the reject/reopen
// routes). The body is a PARTIAL resolved entry — only the field(s) the
// accountant just changed — which is merged onto whatever they'd already chosen.
//
// Still READ-ONLY on QuickBooks: this only records the chosen mapping; nothing is
// posted. Auth + firm scoping: the draft is read under RLS via the authenticated
// client (a row for another firm isn't returned), which IS the authorization.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getDraftForFile,
  saveResolvedPatch,
} from "@/lib/db/quickbooks-suggestions";
import { recordLearnedMapping } from "@/lib/db/quickbooks-learned";
import { learnedWritesFromResolve } from "@/lib/quickbooks/learn";
import type { ResolvedEntry, ResolvedRef } from "@/lib/quickbooks/suggest";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;
// Ref-valued fields (an {id,name} pick or null). `paid` is handled separately
// below because it's a boolean, not a ref.
const FIELDS = [
  "party",
  "account",
  "taxCode",
  "item",
  "paymentAccount",
] as const;
type Field = (typeof FIELDS)[number];

// A value is either null (cleared) or a {id,name} ref. Anything else is rejected.
function parseRef(v: unknown): ResolvedRef | null | undefined {
  if (v === null) return null;
  if (
    v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).id === "string" &&
    typeof (v as Record<string, unknown>).name === "string"
  ) {
    const o = v as { id: string; name: string };
    return { id: o.id, name: o.name };
  }
  return undefined; // malformed
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json(
      { error: "unauth", detail: "Not signed in (session expired?)." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "Could not read the request." },
      { status: 400 },
    );
  }

  // Build the partial patch from the provided fields only (a present key with a
  // malformed value is a 400; an absent key is simply left unchanged).
  const patch: Partial<ResolvedEntry> = {};
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      const ref = parseRef(body[f as Field]);
      if (ref === undefined) {
        return NextResponse.json(
          { error: "bad_request", detail: `Invalid ${f}.` },
          { status: 400 },
        );
      }
      patch[f as Field] = ref;
    }
  }
  // `paid` (Bill vs Purchase) and `split` (split-across-accounts) are boolean|null.
  for (const bf of ["paid", "split"] as const) {
    if (Object.prototype.hasOwnProperty.call(body, bf)) {
      const val = body[bf];
      if (val !== null && typeof val !== "boolean") {
        return NextResponse.json(
          { error: "bad_request", detail: `Invalid ${bf}.` },
          { status: 400 },
        );
      }
      patch[bf] = val;
    }
  }
  // `date` is the transaction-date override (ISO YYYY-MM-DD). It must be a valid
  // date — a transaction can't have its date "cleared" to nothing.
  if (Object.prototype.hasOwnProperty.call(body, "date")) {
    const d = body.date;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json(
        { error: "bad_request", detail: "Invalid date." },
        { status: 400 },
      );
    }
    patch.date = d;
  }
  // `lineAccounts` is the FULL map of line index ("0","1",…) -> ref|null. The
  // client always sends the whole map (merge_qbo_resolved shallow-replaces it).
  if (Object.prototype.hasOwnProperty.call(body, "lineAccounts")) {
    const la = body.lineAccounts;
    if (la === null) {
      patch.lineAccounts = {};
    } else if (typeof la === "object" && !Array.isArray(la)) {
      const map: Record<string, ResolvedRef | null> = {};
      for (const [k, v] of Object.entries(la as Record<string, unknown>)) {
        const ref = parseRef(v);
        if (ref === undefined) {
          return NextResponse.json(
            { error: "bad_request", detail: "Invalid lineAccounts." },
            { status: 400 },
          );
        }
        map[k] = ref;
      }
      patch.lineAccounts = map;
    } else {
      return NextResponse.json(
        { error: "bad_request", detail: "Invalid lineAccounts." },
        { status: 400 },
      );
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "bad_request", detail: "Nothing to update." },
      { status: 400 },
    );
  }

  // Authorize (RLS-scoped read) + resolve the engagement for revalidation. The
  // merge itself happens atomically in the DB (merge_qbo_resolved), so we don't
  // read-modify-write here and can't lose a concurrent edit to another field.
  const draft = await getDraftForFile(fileId);
  if (!draft) {
    return NextResponse.json(
      { error: "not_found", detail: "Draft not found." },
      { status: 404 },
    );
  }

  const ok = await saveResolvedPatch({
    uploadedFileId: fileId,
    patch,
    reviewerId: auth.user.id,
  });
  if (!ok) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // Feature 3 — LEARN from this correction (best-effort; never blocks the save).
  // Each concrete pick (vendor/customer, expense account, tax code, split line
  // account) is remembered per firm, keyed by the normalized source name/tax, so
  // the next matching document auto-picks the same QuickBooks entity. Degrades to
  // a no-op before migration 0490 (recordLearnedMapping swallows a missing table).
  if (draft.suggestion) {
    try {
      const writes = learnedWritesFromResolve(patch, draft.suggestion);
      await Promise.all(
        writes.map((w) =>
          recordLearnedMapping({
            firmId: draft.firmId,
            signalType: w.signalType,
            sourceKey: w.sourceKey,
            sourceSample: w.sourceSample,
            target: w.target,
            reviewerId: auth.user.id,
          }),
        ),
      );
    } catch (err) {
      console.warn("[quickbooks] learn-from-resolve failed:", err);
    }
  }

  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/engagements/${draft.engagementId}`);
  }
  return NextResponse.json({ ok: true });
}
