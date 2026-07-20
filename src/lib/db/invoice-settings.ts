// Data layer for firm invoice settings (migration 0750) — the one-row-per-firm
// setup behind native invoice generation: province, tax registration numbers,
// numbering, and per-invoice defaults. Identity (name / logo / brand color)
// stays on firms and is NOT duplicated here.
//
// GATED like every post-launch table: dev + previews point at the prod DB, so
// every reader treats a missing table/column as "invoicing not set up yet"
// (null) and the app behaves exactly as before the feature. Error-code checks
// only, never message text (the 0650 rule).

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { isProvinceCode, type ProvinceCode } from "@/lib/tax/canada";

export type FirmInvoiceSettings = {
  firm_id: string;
  address: string | null;
  contact_line: string | null;
  province: ProvinceCode;
  gst_number: string | null;
  qst_number: string | null;
  pst_number: string | null;
  invoice_prefix: string;
  next_invoice_seq: number;
  default_terms: string | null;
  default_notes: string | null;
  default_taxes_enabled: boolean;
  created_at: string;
  updated_at: string;
};

// PGRST205 = table missing from the schema cache, 42P01 = undefined table,
// PGRST204 / 42703 = missing column (partial applies), PGRST202 / 42883 =
// missing FUNCTION (the allocate_invoice_seq RPC before 0750 is applied).
export function isInvoiceSettingsSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703" ||
    err?.code === "PGRST202" ||
    err?.code === "42883"
  );
}

function rowToSettings(row: Record<string, unknown>): FirmInvoiceSettings {
  const province = row.province;
  return {
    ...(row as FirmInvoiceSettings),
    // Defensive: an unexpected value in the DB must never leak an invalid
    // province into the tax engine — fall back to the table default.
    province: isProvinceCode(province) ? province : "QC",
  };
}

// The current firm's invoice settings (RLS-scoped). null = the firm hasn't
// set up invoicing (no row, or migration 0750 not applied here) — callers
// treat both identically: no taxes, no formal numbering, today's behavior.
export async function getFirmInvoiceSettings(): Promise<FirmInvoiceSettings | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("firm_invoice_settings")
    .select("*")
    .maybeSingle();
  if (error) {
    if (!isInvoiceSettingsSchemaMissing(error)) {
      console.error("[invoice-settings] get failed:", error);
    }
    return null;
  }
  return data ? rowToSettings(data) : null;
}

// Service-role read for the paths with no user session (invoice automation,
// the client portal, the PDF route). Same null-on-missing contract.
export async function getFirmInvoiceSettingsSR(
  firmId: string,
): Promise<FirmInvoiceSettings | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("firm_invoice_settings")
    .select("*")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) {
    if (!isInvoiceSettingsSchemaMissing(error)) {
      console.error("[invoice-settings] getSR failed:", error);
    }
    return null;
  }
  return data ? rowToSettings(data) : null;
}

export type UpsertInvoiceSettingsInput = {
  address: string | null;
  contact_line: string | null;
  province: ProvinceCode;
  gst_number: string | null;
  qst_number: string | null;
  pst_number: string | null;
  invoice_prefix: string;
  next_invoice_seq: number;
  default_terms: string | null;
  default_notes: string | null;
  default_taxes_enabled: boolean;
};

export type UpsertInvoiceSettingsResult =
  | { ok: true; settings: FirmInvoiceSettings }
  | { ok: false; reason: "unauthenticated" | "migration_pending" | "save_failed" };

// Owner saves the Invoicing settings (the route enforces the owner check;
// RLS enforces firm isolation). Upsert: the row is created on first save.
export async function upsertFirmInvoiceSettings(
  input: UpsertInvoiceSettingsInput,
): Promise<UpsertInvoiceSettingsResult> {
  const firm = await getCurrentFirm();
  if (!firm) return { ok: false, reason: "unauthenticated" };
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("firm_invoice_settings")
    .upsert(
      { firm_id: firm.id, ...input, updated_at: new Date().toISOString() },
      { onConflict: "firm_id" },
    )
    .select("*")
    .single();
  if (error) {
    if (isInvoiceSettingsSchemaMissing(error)) {
      return { ok: false, reason: "migration_pending" };
    }
    console.error("[invoice-settings] upsert failed:", error);
    return { ok: false, reason: "save_failed" };
  }
  return { ok: true, settings: rowToSettings(data) };
}

// ── Numbering ───────────────────────────────────────────────────────────────
// (Number FORMATTING lives in @/lib/invoices/number — pure + client-safe.)

// Atomically claim the next sequence for the current firm (RLS-scoped RPC —
// a session can only ever bump its own firm's counter). null = no settings
// row / migration not applied; the caller falls back to an un-numbered
// invoice rather than blocking creation.
export async function allocateInvoiceSeq(firmId: string): Promise<number | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb.rpc("allocate_invoice_seq", {
    p_firm_id: firmId,
  });
  if (error) {
    if (!isInvoiceSettingsSchemaMissing(error)) {
      console.error("[invoice-settings] allocate failed:", error);
    }
    return null;
  }
  return typeof data === "number" ? data : null;
}

// Service-role variant for the automation path.
export async function allocateInvoiceSeqSR(
  firmId: string,
): Promise<number | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb.rpc("allocate_invoice_seq", {
    p_firm_id: firmId,
  });
  if (error) {
    if (!isInvoiceSettingsSchemaMissing(error)) {
      console.error("[invoice-settings] allocateSR failed:", error);
    }
    return null;
  }
  return typeof data === "number" ? data : null;
}
