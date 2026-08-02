// The lockout state machine, against a stubbed Supabase.
//
// This is the part of the gate that decides whether someone gets in, so it is
// worth exercising directly: the counter has to climb, the fifth failure has
// to lock, a locked client must not be able to burn the lock down by
// hammering, and success has to clear the slate. It also asserts the thing you
// can only get wrong once — that the attempted digits are never written to the
// activity log.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

const state = {
  engagement: { client_id: "client-1", firm_id: "firm-1" } as Row | null,
  client: {} as Row | null,
  updates: [] as Row[],
  activity: [] as Row[],
};

function tableStub(table: string) {
  if (table === "engagements") {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.engagement }) }),
      }),
    };
  }
  if (table === "clients") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.client, error: null }),
        }),
      }),
      update: (patch: Row) => ({
        eq: async () => {
          state.updates.push(patch);
          Object.assign(state.client!, patch);
          return { error: null };
        },
      }),
    };
  }
  if (table === "activity_log") {
    return {
      insert: async (row: Row) => {
        state.activity.push(row);
        return { error: null };
      },
    };
  }
  throw new Error(`unexpected table ${table}`);
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({ from: tableStub }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { verifyPortalPinAttempt, PIN_MAX_ATTEMPTS } from "./gate";
import { encryptPortalPin } from "./pin-cipher";

const KEY = Buffer.alloc(32, 5).toString("base64");
const RIGHT = "314159";
const WRONG = "271828";

describe("PIN lockout", () => {
  const original = process.env.PORTAL_PIN_ENC_KEY;

  beforeEach(() => {
    process.env.PORTAL_PIN_ENC_KEY = KEY;
    state.engagement = { client_id: "client-1", firm_id: "firm-1" };
    state.client = {
      portal_pin_enabled: true,
      portal_pin_encrypted: encryptPortalPin(RIGHT),
      portal_pin_salt: "salt-1",
      portal_pin_failed_attempts: 0,
      portal_pin_locked_until: null,
    };
    state.updates = [];
    state.activity = [];
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PORTAL_PIN_ENC_KEY;
    else process.env.PORTAL_PIN_ENC_KEY = original;
    vi.restoreAllMocks();
  });

  it("lets the right code through and clears the counter", async () => {
    state.client!.portal_pin_failed_attempts = 3;
    const res = await verifyPortalPinAttempt("t", RIGHT);
    expect(res.ok).toBe(true);
    expect(state.client!.portal_pin_failed_attempts).toBe(0);
    expect(state.client!.portal_pin_locked_until).toBeNull();
  });

  it("counts a wrong code down and reports what is left", async () => {
    const first = await verifyPortalPinAttempt("t", WRONG);
    expect(first).toMatchObject({ ok: false, reason: "wrong" });
    expect(state.client!.portal_pin_failed_attempts).toBe(1);

    const second = await verifyPortalPinAttempt("t", WRONG);
    expect(second).toMatchObject({
      ok: false,
      reason: "wrong",
      attemptsRemaining: PIN_MAX_ATTEMPTS - 2,
    });
  });

  it("locks on the fifth failure", async () => {
    for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++) {
      const r = await verifyPortalPinAttempt("t", WRONG);
      expect(r).toMatchObject({ reason: "wrong" });
    }
    const last = await verifyPortalPinAttempt("t", WRONG);
    expect(last).toMatchObject({ ok: false, reason: "locked" });
    expect(state.client!.portal_pin_locked_until).toBeTruthy();
    expect(
      new Date(state.client!.portal_pin_locked_until as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("refuses the RIGHT code while locked — the lock means locked", async () => {
    state.client!.portal_pin_locked_until = new Date(
      Date.now() + 60_000,
    ).toISOString();
    const res = await verifyPortalPinAttempt("t", RIGHT);
    expect(res).toMatchObject({ ok: false, reason: "locked" });
  });

  it("does not extend the lock by hammering it", async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    state.client!.portal_pin_locked_until = until;
    for (let i = 0; i < 10; i++) await verifyPortalPinAttempt("t", WRONG);
    expect(state.client!.portal_pin_locked_until).toBe(until);
    // Nothing was written to the client row at all during the lock.
    expect(state.updates).toHaveLength(0);
  });

  it("lets a fresh set of attempts through once the lock has expired", async () => {
    state.client!.portal_pin_locked_until = new Date(
      Date.now() - 1000,
    ).toISOString();
    state.client!.portal_pin_failed_attempts = 0;
    const res = await verifyPortalPinAttempt("t", RIGHT);
    expect(res.ok).toBe(true);
  });

  it("is unavailable when the feature is off for this client", async () => {
    state.client!.portal_pin_enabled = false;
    const res = await verifyPortalPinAttempt("t", RIGHT);
    expect(res).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("rejects a malformed attempt without ever comparing it", async () => {
    const res = await verifyPortalPinAttempt("t", "abc");
    expect(res).toMatchObject({ ok: false, reason: "wrong" });
  });

  // THE ONE THAT MUST NEVER REGRESS.
  it("NEVER writes the attempted digits to the activity log", async () => {
    await verifyPortalPinAttempt("t", WRONG);
    await verifyPortalPinAttempt("t", RIGHT);
    expect(state.activity.length).toBeGreaterThan(0);
    const dump = JSON.stringify(state.activity);
    expect(dump).not.toContain(WRONG);
    expect(dump).not.toContain(RIGHT);
    for (const row of state.activity) {
      expect(row.actor_type).toBe("client");
      expect(row.firm_id).toBe("firm-1");
      expect((row.metadata as Row).client_id).toBe("client-1");
    }
  });

  it("logs the failure, the lock and the success under distinct actions", async () => {
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) {
      await verifyPortalPinAttempt("t", WRONG);
    }
    const actions = state.activity.map((r) => r.action);
    expect(actions).toContain("portal_pin_failed");
    expect(actions).toContain("portal_pin_locked");

    state.client!.portal_pin_locked_until = null;
    await verifyPortalPinAttempt("t", RIGHT);
    expect(state.activity.map((r) => r.action)).toContain("portal_pin_success");
  });
});
