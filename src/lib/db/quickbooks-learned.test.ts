// INTEGRATION test for the learn loop: the REAL recordLearnedMapping writing
// into a fake table, then the REAL readLearnedMappingsForFirm reading it back.
//
// This file exists because the loop was dead for a year and nothing noticed.
// The write omitted clientId, so rows landed in the client_id IS NULL namespace
// while every reader filtered .eq("client_id", <uuid>) — both sides succeeded,
// the read just returned zero rows, which is indistinguishable from "nothing
// learned yet". Pure unit tests could not catch it: learn.test.ts hand-builds
// the LearnedMappings object and suggest.test.ts is handed one, so neither ever
// pairs a real write with a real read.
//
// The fake below models the ONE PostgREST behaviour that made the bug invisible:
// .eq("client_id", uuid) and .is("client_id", null) select disjoint row sets,
// and a query matching nothing is a SUCCESS with zero rows, not an error.

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

const table: Row[] = [];

// A minimal PostgREST-shaped query builder over `table`.
function makeClient() {
  return {
    from() {
      const filters: Array<(r: Row) => boolean> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        is(col: string, val: unknown) {
          // PostgREST `is null` matches SQL NULL only.
          filters.push((r) => (r[col] ?? null) === val);
          return builder;
        },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          // NULLS NOT DISTINCT: two NULL client_ids collide on the same row —
          // which is why every client used to overwrite every other client.
          const idx = table.findIndex((existing) =>
            keys.every((k) => (existing[k] ?? null) === (row[k] ?? null)),
          );
          if (idx >= 0) table[idx] = { ...table[idx], ...row };
          else table.push({ ...row });
          return Promise.resolve({ error: null });
        },
        // recordLearnedMapping reads the prior row to increment
        // times_confirmed, so the fake has to support the read shape too.
        limit(_n: number) {
          return builder;
        },
        maybeSingle() {
          const rows = table.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          const data = table.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => makeClient(),
  getServerSupabase: () => Promise.resolve(makeClient()),
}));

const { recordLearnedMapping, readLearnedMappingsForFirm } = await import(
  "./quickbooks-learned"
);

const FIRM = "firm-1";
const CLIENT_A = "11111111-1111-1111-1111-111111111111";
const CLIENT_B = "22222222-2222-2222-2222-222222222222";

async function learn(clientId: string | undefined, target: string) {
  await recordLearnedMapping({
    firmId: FIRM,
    clientId,
    signalType: "expense_account",
    sourceKey: "home depot",
    sourceSample: "Home Depot",
    target: { id: target, name: target },
    reviewerId: "user-1",
  });
}

beforeEach(() => {
  table.length = 0;
});

describe("learn loop — write then read", () => {
  it("recalls what was written for the same client", async () => {
    await learn(CLIENT_A, "acct-repairs");
    const back = await readLearnedMappingsForFirm(FIRM, CLIENT_A);
    expect(back.expense_account?.["home depot"]).toEqual({
      id: "acct-repairs",
      name: "acct-repairs",
    });
  });

  // THE ACTUAL BUG, pinned. Writing without a clientId lands in the firm-level
  // namespace; the client-scoped read that every real caller uses cannot see it.
  it("recalls NOTHING when the write omits the client id", async () => {
    await learn(undefined, "acct-repairs");
    expect(table).toHaveLength(1); // the row IS there...
    const back = await readLearnedMappingsForFirm(FIRM, CLIENT_A);
    expect(back).toEqual({}); // ...and the read still finds nothing.
  });

  it("keeps one client's memory out of another's", async () => {
    await learn(CLIENT_A, "acct-repairs");
    await learn(CLIENT_B, "acct-cogs");
    const a = await readLearnedMappingsForFirm(FIRM, CLIENT_A);
    const b = await readLearnedMappingsForFirm(FIRM, CLIENT_B);
    expect(a.expense_account?.["home depot"]?.id).toBe("acct-repairs");
    expect(b.expense_account?.["home depot"]?.id).toBe("acct-cogs");
    expect(table).toHaveLength(2);
  });

  // The second bug the missing clientId caused: with client_id always NULL and
  // a NULLS NOT DISTINCT unique index, every client collapsed onto one row.
  it("collides every client onto one row when the client id is omitted", async () => {
    await learn(undefined, "acct-repairs");
    await learn(undefined, "acct-cogs");
    expect(table).toHaveLength(1);
    expect(table[0].target_qbo_id).toBe("acct-cogs"); // A's pick destroyed
  });

  it("re-correcting the same client replaces that client's row", async () => {
    await learn(CLIENT_A, "acct-repairs");
    await learn(CLIENT_A, "acct-utilities");
    expect(table).toHaveLength(1);
    const back = await readLearnedMappingsForFirm(FIRM, CLIENT_A);
    expect(back.expense_account?.["home depot"]?.id).toBe("acct-utilities");
  });

  it("does not leak across firms", async () => {
    await learn(CLIENT_A, "acct-repairs");
    const other = await readLearnedMappingsForFirm("firm-2", CLIENT_A);
    expect(other).toEqual({});
  });
});

// times_confirmed is what gates unattended approval, so its counting rules are
// safety-critical: a mapping seen once is a sighting, seen three times a habit.
describe("times_confirmed", () => {
  const row = () => table[0] as { times_confirmed?: number };

  it("starts at 1 and increments on each re-confirmation", async () => {
    await learn(CLIENT_A, "acct-repairs");
    expect(row().times_confirmed).toBe(1);
    await learn(CLIENT_A, "acct-repairs");
    expect(row().times_confirmed).toBe(2);
    await learn(CLIENT_A, "acct-repairs");
    expect(row().times_confirmed).toBe(3);
  });

  // Changing the answer means the accountant just corrected us. The NEW mapping
  // has been confirmed exactly once and has to earn trust from scratch —
  // otherwise a correction would inherit the old answer's credibility and be
  // auto-approved immediately.
  it("resets to 1 when the accountant changes the answer", async () => {
    await learn(CLIENT_A, "acct-repairs");
    await learn(CLIENT_A, "acct-repairs");
    expect(row().times_confirmed).toBe(2);
    await learn(CLIENT_A, "acct-utilities");
    expect(row().times_confirmed).toBe(1);
  });

  it("counts per client, not per firm", async () => {
    await learn(CLIENT_A, "acct-repairs");
    await learn(CLIENT_A, "acct-repairs");
    await learn(CLIENT_B, "acct-repairs");
    const a = table.find((r) => r.client_id === CLIENT_A) as { times_confirmed?: number };
    const b = table.find((r) => r.client_id === CLIENT_B) as { times_confirmed?: number };
    expect(a.times_confirmed).toBe(2);
    expect(b.times_confirmed).toBe(1);
  });
});
