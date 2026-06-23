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
  saveResolvedForFile,
} from "@/lib/db/quickbooks-suggestions";
import type { ResolvedEntry, ResolvedRef } from "@/lib/quickbooks/suggest";

export const runtime = "nodejs";

const LOCALES = ["en", "fr"] as const;
const FIELDS = ["party", "account", "taxCode"] as const;
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
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "bad_request", detail: "Nothing to update." },
      { status: 400 },
    );
  }

  // Authorize + read the existing resolved picks (RLS-scoped) to merge onto.
  const draft = await getDraftForFile(fileId);
  if (!draft) {
    return NextResponse.json(
      { error: "not_found", detail: "Draft not found." },
      { status: 404 },
    );
  }

  const existing = draft.resolved;
  const merged: ResolvedEntry = {
    party: "party" in patch ? (patch.party ?? null) : (existing?.party ?? null),
    account:
      "account" in patch ? (patch.account ?? null) : (existing?.account ?? null),
    taxCode:
      "taxCode" in patch
        ? (patch.taxCode ?? null)
        : (existing?.taxCode ?? null),
  };

  const ok = await saveResolvedForFile({
    uploadedFileId: fileId,
    resolved: merged,
    reviewerId: auth.user.id,
  });
  if (!ok) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/engagements/${draft.engagementId}`);
  }
  return NextResponse.json({ ok: true, resolved: merged });
}
