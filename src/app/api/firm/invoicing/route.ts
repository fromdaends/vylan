import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { upsertFirmInvoiceSettings } from "@/lib/db/invoice-settings";
import { isProvinceCode } from "@/lib/tax/canada";

// Firm invoice settings (migration 0750): province, tax registration numbers,
// numbering, defaults. Owner-only firm policy; mirrors the other firm-setting
// POST routes (invoice-defaults / service-prices).

export const runtime = "nodejs";

// Trim to null, capped — the DB CHECKs are the backstop, this keeps errors
// friendly instead of a 500 on an over-long paste.
function cleanText(v: unknown, max: number): string | null | "invalid" {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const t = v.trim();
  if (t === "") return null;
  if (t.length > max) return "invalid";
  return t;
}

// Control characters (C0 + DEL) never belong in an invoice prefix.
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const province = body.province;
  if (!isProvinceCode(province)) {
    return NextResponse.json({ error: "invalid_province" }, { status: 400 });
  }

  const address = cleanText(body.address, 500);
  const contactLine = cleanText(body.contactLine, 200);
  const gstNumber = cleanText(body.gstNumber, 50);
  const qstNumber = cleanText(body.qstNumber, 50);
  const pstNumber = cleanText(body.pstNumber, 50);
  const defaultTerms = cleanText(body.defaultTerms, 300);
  const defaultNotes = cleanText(body.defaultNotes, 500);
  if (
    [
      address,
      contactLine,
      gstNumber,
      qstNumber,
      pstNumber,
      defaultTerms,
      defaultNotes,
    ].includes("invalid")
  ) {
    return NextResponse.json({ error: "invalid_field" }, { status: 400 });
  }

  // Prefix: bounded, no control characters; empty allowed (bare numbers).
  const prefixRaw =
    typeof body.invoicePrefix === "string" ? body.invoicePrefix.trim() : "";
  if (prefixRaw.length > 12 || hasControlChars(prefixRaw)) {
    return NextResponse.json({ error: "invalid_prefix" }, { status: 400 });
  }

  const nextSeq = Math.floor(Number(body.nextInvoiceSeq));
  if (!Number.isFinite(nextSeq) || nextSeq < 1 || nextSeq > 999_999_999) {
    return NextResponse.json({ error: "invalid_next_seq" }, { status: 400 });
  }

  const defaultTaxesEnabled = body.defaultTaxesEnabled === true;

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }

  const res = await upsertFirmInvoiceSettings({
    address: address as string | null,
    contact_line: contactLine as string | null,
    province,
    gst_number: gstNumber as string | null,
    qst_number: qstNumber as string | null,
    pst_number: pstNumber as string | null,
    invoice_prefix: prefixRaw,
    next_invoice_seq: nextSeq,
    default_terms: defaultTerms as string | null,
    default_notes: defaultNotes as string | null,
    default_taxes_enabled: defaultTaxesEnabled,
  });
  if (!res.ok) {
    if (res.reason === "migration_pending") {
      return NextResponse.json({ error: "migration_pending" }, { status: 409 });
    }
    const status = res.reason === "unauthenticated" ? 401 : 500;
    return NextResponse.json({ error: res.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
