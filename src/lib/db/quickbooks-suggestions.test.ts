import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression guard for the per-client FAIL-CLOSED invariant (0710): a draft's
// clientId comes from its engagement, and engagements.client_id is NOT NULL —
// so an unresolvable client can only mean the lookup FAILED. These lock in that
// a failed/absent engagement read makes the reader bail (null / []) instead of
// silently degrading to firm-level scope, where a leftover legacy firm-level
// connection would route a post/void/delete to the WRONG QuickBooks company.

type Res = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

// Per-table FIFO of canned responses. Every query builder chain (select/eq/
// order/in/not) returns itself; awaiting it (or .maybeSingle()) pops the next
// canned response for its table. Missing queue → empty success.
let queues: Record<string, Res[]>;
function nextRes(table: string): Res {
  return queues[table]?.shift() ?? { data: null, error: null };
}
function makeQuery(table: string) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    in: () => q,
    not: () => q,
    maybeSingle: () => Promise.resolve(nextRes(table)),
    then: (
      onOk: (v: Res) => unknown,
      onErr?: (e: unknown) => unknown,
    ) => Promise.resolve(nextRes(table)).then(onOk, onErr),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ from: (t: string) => makeQuery(t) }),
  getServiceRoleSupabase: () => ({ from: (t: string) => makeQuery(t) }),
}));

import { getDraftForFile, listFirmDrafts } from "./quickbooks-suggestions";

const DRAFT_ROW = {
  engagement_id: "e1",
  firm_id: "f1",
  resolved: null,
  suggestion: { direction: "expense", taxes: [] },
  status: "approved",
  posted_qbo_id: null,
  posted_qbo_sync_token: null,
  post_attempt: 0,
  receipt_attached_at: null,
  matched_qbo_type: null,
};

beforeEach(() => {
  queues = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getDraftForFile — per-client scope resolution", () => {
  it("returns the engagement's clientId when the lookup succeeds", async () => {
    queues = {
      quickbooks_transaction_suggestions: [{ data: DRAFT_ROW, error: null }],
      engagements: [{ data: { client_id: "c1" }, error: null }],
    };
    const draft = await getDraftForFile("file-1");
    expect(draft).not.toBeNull();
    expect(draft!.clientId).toBe("c1");
    expect(draft!.firmId).toBe("f1");
  });

  it("FAILS CLOSED (null) when the engagement read errors — never firm-level", async () => {
    queues = {
      quickbooks_transaction_suggestions: [{ data: DRAFT_ROW, error: null }],
      engagements: [
        { data: null, error: { code: "XX000", message: "transient" } },
      ],
    };
    expect(await getDraftForFile("file-1")).toBeNull();
  });

  it("FAILS CLOSED (null) when the engagement row is absent", async () => {
    queues = {
      quickbooks_transaction_suggestions: [{ data: DRAFT_ROW, error: null }],
      engagements: [{ data: null, error: null }],
    };
    expect(await getDraftForFile("file-1")).toBeNull();
  });
});

describe("listFirmDrafts — per-client scope resolution", () => {
  const SUGGESTION_ROWS = [
    {
      uploaded_file_id: "file-1",
      engagement_id: "e1",
      suggestion: { direction: "expense", taxes: [] },
      resolved: null,
      status: "approved",
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    },
  ];

  it("carries each row's clientId from its engagement", async () => {
    queues = {
      quickbooks_transaction_suggestions: [
        { data: SUGGESTION_ROWS, error: null },
      ],
      engagements: [
        { data: [{ id: "e1", title: "T1", client_id: "c1" }], error: null },
      ],
      uploaded_files: [{ data: [], error: null }],
      clients: [{ data: [{ id: "c1", display_name: "Acme" }], error: null }],
    };
    const rows = await listFirmDrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).toBe("c1");
  });

  it("FAILS CLOSED ([]) when the engagement batch read errors — a bulk post must never default a whole batch to firm-level", async () => {
    queues = {
      quickbooks_transaction_suggestions: [
        { data: SUGGESTION_ROWS, error: null },
      ],
      engagements: [
        { data: null, error: { code: "XX000", message: "transient" } },
      ],
      uploaded_files: [{ data: [], error: null }],
    };
    expect(await listFirmDrafts()).toEqual([]);
  });
});
