import { describe, it, expect, vi, beforeEach } from "vitest";

// Mode is controlled per-test; the DB is a tiny chainable stub whose select
// result and update outcome we set per-test, and whose update payload we spy on.
let mode: "test" | "live" | null = "live";
let selectResult: { data: unknown; error: unknown } = { data: null, error: null };
let updateResult: { error: unknown } = { error: null };
const updateSpy = vi.fn();

function chain() {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.update = vi.fn((payload: unknown) => {
    updateSpy(payload);
    return c;
  });
  c.eq = vi.fn(() => c);
  c.maybeSingle = vi.fn(() => Promise.resolve(selectResult));
  // awaited update().eq() resolves to updateResult
  c.then = (resolve: (v: unknown) => void) => resolve(updateResult);
  return c;
}

vi.mock("@/lib/stripe", () => ({
  stripe: () => null,
  stripeKeyMode: () => mode,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({ from: vi.fn(() => chain()) }),
}));

import {
  setFirmConnectAccountId,
  applyConnectAccountStatus,
} from "./stripe-connect";

beforeEach(() => {
  vi.clearAllMocks();
  mode = "live";
  selectResult = { data: null, error: null };
  updateResult = { error: null };
});

describe("setFirmConnectAccountId — mode stamping + anti-clobber", () => {
  it("refuses a TEST-mode connect that would clobber a LIVE connection", async () => {
    mode = "test";
    selectResult = {
      data: { stripe_connect_account_id: "acct_live", stripe_connect_mode: "live" },
      error: null,
    };
    const res = await setFirmConnectAccountId("firm1", "acct_test_new");
    expect(res).toEqual({ ok: false, reason: "would_clobber_live" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("stamps the mode and writes when connecting live (no existing live to clobber)", async () => {
    mode = "live";
    selectResult = { data: null, error: null }; // fresh firm, no account yet
    const res = await setFirmConnectAccountId("firm1", "acct_live_new");
    expect(res).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith({
      stripe_connect_account_id: "acct_live_new",
      stripe_connect_mode: "live",
    });
  });

  it("allows a live connect to replace a test connection", async () => {
    mode = "live";
    selectResult = {
      data: { stripe_connect_account_id: "acct_test", stripe_connect_mode: "test" },
      error: null,
    };
    const res = await setFirmConnectAccountId("firm1", "acct_live_new");
    expect(res).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith({
      stripe_connect_account_id: "acct_live_new",
      stripe_connect_mode: "live",
    });
  });
});

describe("applyConnectAccountStatus — anti-mutate", () => {
  const status = {
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  };
  const liveFirm = {
    id: "firm1",
    stripe_connect_account_id: "acct_live",
    connect_charges_enabled: true,
    connect_payouts_enabled: true,
    connect_details_submitted: true,
    connect_onboarded_at: "2026-01-01T00:00:00Z",
    stripe_connect_mode: "live" as const,
  };

  it("skips writing when a TEST env would overwrite a LIVE firm", async () => {
    mode = "test";
    await applyConnectAccountStatus(liveFirm, status);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("writes and stamps the mode when the env matches (live)", async () => {
    mode = "live";
    await applyConnectAccountStatus(liveFirm, status);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      connect_charges_enabled: true,
      stripe_connect_mode: "live",
    });
  });
});
