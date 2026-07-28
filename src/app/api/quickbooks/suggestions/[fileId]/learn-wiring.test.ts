// Route-level guard for the exact defect that killed the learn loop: a route
// calling recordLearnedMapping WITHOUT the client id.
//
// The data layer is proven separately (src/lib/db/quickbooks-learned.test.ts
// round-trips a real write into a real read). What that cannot see is the
// caller, and the caller is where the bug lived — recordLearnedMapping takes
// clientId as OPTIONAL, so omitting it is not a type error, not a runtime
// error, and not a failed query. It just writes to the firm-level namespace
// that no reader looks in.
//
// These tests drive the real route handlers and assert on the argument. Both
// learning routes are covered: resolve (a correction) and status (an approval).

import { describe, it, expect, beforeEach, vi } from "vitest";

const FIRM = "firm-1";
const CLIENT = "11111111-1111-1111-1111-111111111111";
const ENGAGEMENT = "eng-1";
const FILE = "file-1";

// Typed so the assertions below see the argument shape (an untyped vi.fn()
// infers a zero-length tuple and every mock.calls[0] access fails to compile).
type LearnCall = {
  firmId: string;
  clientId?: string | null;
  signalType: string;
  sourceKey: string;
  sourceSample: string;
  target: { id: string; name: string };
  reviewerId: string | null;
};
const recordLearnedMapping = vi.fn<(input: LearnCall) => Promise<void>>(() =>
  Promise.resolve(),
);

// A draft whose vendor the AI matched, so both routes have something to learn.
const draft = {
  firmId: FIRM,
  clientId: CLIENT,
  engagementId: ENGAGEMENT,
  status: "draft",
  resolved: null,
  suggestion: {
    direction: "expense",
    partyKind: "vendor",
    partySource: "Home Depot",
    taxSource: "GST+QST",
    party: { match: { id: "v1", name: "The Home Depot Inc." }, candidates: [] },
    account: { match: { id: "a1", name: "Supplies" }, candidates: [] },
    taxCode: { match: { id: "t1", name: "GST/QST QC" }, candidates: [] },
    item: { match: null, candidates: [] },
    paymentAccount: { match: null, candidates: [] },
    lines: [],
    date: "2024-03-14",
    currency: "CAD",
    // Complete enough to pass canApproveDraft — an incomplete draft is rejected
    // with 422 before any learning happens, which is correct and is what the
    // first version of this fixture accidentally proved.
    amount: 114.98,
    taxTotal: 14.98,
    paid: false,
    split: false,
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    }),
}));
vi.mock("@/lib/db/quickbooks-learned", () => ({ recordLearnedMapping }));
vi.mock("@/lib/db/quickbooks-suggestions", () => ({
  getDraftForFile: () => Promise.resolve(draft),
  saveResolvedPatch: () => Promise.resolve(true),
  setDraftStatus: () => Promise.resolve(true),
}));
vi.mock("@/lib/db/activity", () => ({ logUserActivity: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { POST: resolvePost } = await import("./resolve/route");
const { POST: statusPost } = await import("./status/route");

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}
const params = Promise.resolve({ fileId: FILE });

beforeEach(() => recordLearnedMapping.mockClear());

describe("resolve route — a correction is learned against the client", () => {
  it("passes the draft's clientId to every learned write", async () => {
    await resolvePost(req({ account: { id: "a9", name: "Repairs" } }), {
      params,
    });
    expect(recordLearnedMapping).toHaveBeenCalled();
    for (const [arg] of recordLearnedMapping.mock.calls) {
      // The whole bug in one assertion.
      expect(arg).toMatchObject({ firmId: FIRM, clientId: CLIENT });
      expect(arg.clientId).not.toBeUndefined();
      expect(arg.clientId).not.toBeNull();
    }
  });
});

describe("status route — an approval also teaches", () => {
  it("records the effective picks with the clientId on approve", async () => {
    await statusPost(req({ status: "approved" }), { params });
    expect(recordLearnedMapping).toHaveBeenCalled();
    const signals = recordLearnedMapping.mock.calls.map((c) => c[0].signalType);
    // Approving teaches the vendor, its expense account and the tax code even
    // though the accountant changed nothing — that is the point of the change.
    expect(signals).toContain("vendor");
    expect(signals).toContain("expense_account");
    expect(signals).toContain("tax");
    for (const [arg] of recordLearnedMapping.mock.calls) {
      expect(arg.clientId).toBe(CLIENT);
    }
  });

  it("teaches nothing when the draft is dismissed", async () => {
    await statusPost(req({ status: "dismissed" }), { params });
    expect(recordLearnedMapping).not.toHaveBeenCalled();
  });
});
