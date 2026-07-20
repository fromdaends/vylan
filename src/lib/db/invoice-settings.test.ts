import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable stub in the repo's db-test idiom: per-test results, spied writes.
let selectResult: { data: unknown; error: unknown } = { data: null, error: null };
let upsertResult: { data: unknown; error: unknown } = { data: null, error: null };
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const upsertSpy = vi.fn();
const rpcSpy = vi.fn();

function chain() {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.maybeSingle = vi.fn(() => Promise.resolve(selectResult));
  c.single = vi.fn(() => Promise.resolve(upsertResult));
  c.upsert = vi.fn((payload: unknown, opts: unknown) => {
    upsertSpy(payload, opts);
    return c;
  });
  return c;
}

const client = {
  from: vi.fn(() => chain()),
  rpc: vi.fn((fn: string, args: unknown) => {
    rpcSpy(fn, args);
    return Promise.resolve(rpcResult);
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => client,
  getServiceRoleSupabase: () => client,
}));
vi.mock("@/lib/db/firms", () => ({
  getCurrentFirm: vi.fn(async () => ({ id: "firm1" })),
}));

import {
  getFirmInvoiceSettings,
  upsertFirmInvoiceSettings,
  allocateInvoiceSeq,
  allocateInvoiceSeqSR,
  isInvoiceSettingsSchemaMissing,
} from "./invoice-settings";
import { formatInvoiceNumber } from "@/lib/invoices/number";

const SETTINGS_ROW = {
  firm_id: "firm1",
  address: "123 Main",
  contact_line: null,
  province: "QC",
  gst_number: "123456789 RT0001",
  qst_number: "1234567890 TQ0001",
  pst_number: null,
  invoice_prefix: "INV-",
  next_invoice_seq: 12,
  default_terms: "Due on receipt",
  default_notes: null,
  default_taxes_enabled: true,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = { data: null, error: null };
  upsertResult = { data: null, error: null };
  rpcResult = { data: null, error: null };
});

describe("isInvoiceSettingsSchemaMissing", () => {
  it("matches the missing-schema codes (table, column, function) and nothing else", () => {
    for (const code of [
      "PGRST205",
      "42P01",
      "PGRST204",
      "42703",
      "PGRST202",
      "42883",
    ]) {
      expect(isInvoiceSettingsSchemaMissing({ code })).toBe(true);
    }
    expect(isInvoiceSettingsSchemaMissing({ code: "23505" })).toBe(false);
    expect(isInvoiceSettingsSchemaMissing(null)).toBe(false);
  });
});

describe("getFirmInvoiceSettings", () => {
  it("returns the row when present", async () => {
    selectResult = { data: SETTINGS_ROW, error: null };
    const s = await getFirmInvoiceSettings();
    expect(s?.province).toBe("QC");
    expect(s?.next_invoice_seq).toBe(12);
  });

  it("returns null when no row exists (invoicing not set up)", async () => {
    selectResult = { data: null, error: null };
    expect(await getFirmInvoiceSettings()).toBeNull();
  });

  it("returns null quietly pre-migration (table missing)", async () => {
    selectResult = { data: null, error: { code: "PGRST205" } };
    expect(await getFirmInvoiceSettings()).toBeNull();
  });

  it("falls back to QC on a corrupt province value (tax engine safety)", async () => {
    selectResult = { data: { ...SETTINGS_ROW, province: "ZZ" }, error: null };
    const s = await getFirmInvoiceSettings();
    expect(s?.province).toBe("QC");
  });
});

describe("upsertFirmInvoiceSettings", () => {
  const INPUT = {
    address: "123 Main",
    contact_line: null,
    province: "ON" as const,
    gst_number: null,
    qst_number: null,
    pst_number: null,
    invoice_prefix: "F-",
    next_invoice_seq: 500,
    default_terms: null,
    default_notes: null,
    default_taxes_enabled: false,
  };

  it("upserts keyed on firm_id and returns the saved row", async () => {
    upsertResult = {
      data: { ...SETTINGS_ROW, ...INPUT },
      error: null,
    };
    const res = await upsertFirmInvoiceSettings(INPUT);
    expect(res.ok).toBe(true);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ firm_id: "firm1", province: "ON" }),
      { onConflict: "firm_id" },
    );
  });

  it("reports migration_pending when the table is missing", async () => {
    upsertResult = { data: null, error: { code: "PGRST205" } };
    const res = await upsertFirmInvoiceSettings(INPUT);
    expect(res).toEqual({ ok: false, reason: "migration_pending" });
  });

  it("reports save_failed on any other error", async () => {
    upsertResult = { data: null, error: { code: "XX000" } };
    const res = await upsertFirmInvoiceSettings(INPUT);
    expect(res).toEqual({ ok: false, reason: "save_failed" });
  });
});

describe("allocateInvoiceSeq", () => {
  it("returns the allocated sequence from the RPC", async () => {
    rpcResult = { data: 42, error: null };
    expect(await allocateInvoiceSeq("firm1")).toBe(42);
    expect(rpcSpy).toHaveBeenCalledWith("allocate_invoice_seq", {
      p_firm_id: "firm1",
    });
  });

  it("returns null when the firm has no settings row (RPC returns null)", async () => {
    rpcResult = { data: null, error: null };
    expect(await allocateInvoiceSeq("firm1")).toBeNull();
  });

  it("returns null quietly pre-migration (RPC function missing)", async () => {
    rpcResult = { data: null, error: { code: "PGRST202" } };
    expect(await allocateInvoiceSeq("firm1")).toBeNull();
  });

  it("SR variant uses the same contract", async () => {
    rpcResult = { data: 7, error: null };
    expect(await allocateInvoiceSeqSR("firm1")).toBe(7);
  });
});

describe("formatInvoiceNumber", () => {
  it("zero-pads to 4 and grows past 9999", () => {
    expect(formatInvoiceNumber("INV-", 1)).toBe("INV-0001");
    expect(formatInvoiceNumber("INV-", 42)).toBe("INV-0042");
    expect(formatInvoiceNumber("F", 12345)).toBe("F12345");
    expect(formatInvoiceNumber("", 7)).toBe("0007");
  });
});
