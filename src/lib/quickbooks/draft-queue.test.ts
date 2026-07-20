import { describe, it, expect } from "vitest";
import {
  QUEUE_FILTERS,
  QUEUE_BUCKETS,
  draftQueueBucket,
  parseQueueFilter,
  matchesQueueFilter,
  countQueueBuckets,
  bucketRank,
  queueHealthScopes,
  type QueueItem,
} from "./draft-queue";
import type {
  TransactionSuggestion,
  MatchField,
  ResolvedEntry,
} from "./suggest";

const matched = (name: string): MatchField => ({
  match: { id: "x", name, active: true },
  confidence: 0.9,
  candidates: [],
});
const noMatch: MatchField = { match: null, confidence: 0, candidates: [] };

// A complete (approvable) draft by default; tests knock out a field.
function sugg(over: Partial<TransactionSuggestion> = {}): TransactionSuggestion {
  return {
    direction: "expense",
    partyKind: "vendor",
    party: matched("Home Depot"),
    account: matched("Supplies"),
    taxCode: matched("GST/QST"),
    amount: 100,
    subtotal: 88,
    taxTotal: 12,
    date: "2024-03-14",
    currency: "CAD",
    overallConfidence: 0.8,
    notes: [],
    ...over,
  };
}
function item(
  suggestion: TransactionSuggestion,
  status: QueueItem["status"] = "draft",
  resolved: ResolvedEntry | null = null,
): QueueItem {
  return { suggestion, resolved, status };
}

describe("draftQueueBucket", () => {
  it("a complete open draft is 'ready'", () => {
    expect(draftQueueBucket(item(sugg()))).toBe("ready");
  });
  it("an incomplete open draft is 'needs_input'", () => {
    expect(draftQueueBucket(item(sugg({ account: noMatch })))).toBe(
      "needs_input",
    );
  });
  it("a resolved field makes an incomplete draft 'ready'", () => {
    expect(
      draftQueueBucket(
        item(sugg({ account: noMatch }), "draft", {
          party: null,
          account: { id: "a1", name: "Supplies" },
          taxCode: null,
        }),
      ),
    ).toBe("ready");
  });
  it("approved + dismissed map to their own buckets regardless of completeness", () => {
    expect(draftQueueBucket(item(sugg(), "approved"))).toBe("approved");
    // even an 'incomplete' dismissed draft is just 'dismissed'
    expect(draftQueueBucket(item(sugg({ account: noMatch }), "dismissed"))).toBe(
      "dismissed",
    );
  });
  it("unknown/absent status is treated as an open draft", () => {
    expect(draftQueueBucket({ suggestion: sugg(), resolved: null })).toBe(
      "ready",
    );
    expect(draftQueueBucket(item(sugg(), "weird"))).toBe("ready");
  });
});

describe("parseQueueFilter", () => {
  it("keeps known filters", () => {
    for (const f of QUEUE_FILTERS) expect(parseQueueFilter(f)).toBe(f);
  });
  it("defaults unknown/empty to 'all'", () => {
    expect(parseQueueFilter(null)).toBe("all");
    expect(parseQueueFilter(undefined)).toBe("all");
    expect(parseQueueFilter("nope")).toBe("all");
  });
});

describe("matchesQueueFilter", () => {
  it("'all' shows everything except dismissed", () => {
    expect(matchesQueueFilter("all", "needs_input")).toBe(true);
    expect(matchesQueueFilter("all", "ready")).toBe(true);
    expect(matchesQueueFilter("all", "approved")).toBe(true);
    expect(matchesQueueFilter("all", "dismissed")).toBe(false);
  });
  it("a specific filter shows only its own bucket", () => {
    expect(matchesQueueFilter("approved", "approved")).toBe(true);
    expect(matchesQueueFilter("approved", "ready")).toBe(false);
    expect(matchesQueueFilter("dismissed", "dismissed")).toBe(true);
  });
});

describe("countQueueBuckets", () => {
  it("counts each bucket and the total", () => {
    const counts = countQueueBuckets([
      item(sugg()), // ready
      item(sugg({ party: noMatch })), // needs_input
      item(sugg(), "approved"),
      item(sugg(), "posted"),
      item(sugg(), "dismissed"),
      item(sugg(), "dismissed"),
    ]);
    expect(counts).toEqual({
      needs_input: 1,
      ready: 1,
      approved: 1,
      posted: 1,
      dismissed: 2,
      total: 6,
    });
  });
  it("an empty set is all zeros", () => {
    expect(countQueueBuckets([])).toEqual({
      needs_input: 0,
      ready: 0,
      approved: 0,
      posted: 0,
      dismissed: 0,
      total: 0,
    });
  });
});

describe("income drafts (need an item, not an account)", () => {
  const matchedItem = { id: "it1", name: "Consulting", active: true };
  // An income draft with customer + tax matched, account matched, but NO item.
  function incomeSugg(over: Partial<TransactionSuggestion> = {}) {
    return sugg({
      direction: "income",
      partyKind: "customer",
      party: matched("A Client"),
      item: { match: null, confidence: 0, candidates: [] },
      ...over,
    });
  }

  it("an income draft with no item needs input even though the account is matched", () => {
    expect(draftQueueBucket(item(incomeSugg()))).toBe("needs_input");
  });
  it("an income draft with a matched item is ready (item satisfies the mapping)", () => {
    expect(
      draftQueueBucket(
        item({ ...incomeSugg(), item: { match: matchedItem, confidence: 0.9, candidates: [] } }),
      ),
    ).toBe("ready");
  });
  it("an old income suggestion missing the item field still needs input (defensive)", () => {
    // Simulate a pre-income suggestion stored in the DB with no `item` key.
    const s = incomeSugg();
    delete (s as { item?: unknown }).item;
    expect(draftQueueBucket(item(s))).toBe("needs_input");
  });
  it("a resolved item makes an income draft ready", () => {
    expect(
      draftQueueBucket(
        item(incomeSugg(), "draft", {
          party: null,
          account: null,
          taxCode: null,
          item: { id: "it9", name: "Picked" },
        }),
      ),
    ).toBe("ready");
  });
});

describe("posted bucket (Stage 5)", () => {
  it("a posted draft is in the 'posted' bucket regardless of completeness", () => {
    expect(draftQueueBucket(item(sugg(), "posted"))).toBe("posted");
    expect(draftQueueBucket(item(sugg({ account: noMatch }), "posted"))).toBe(
      "posted",
    );
  });
  it("'all' excludes both posted and dismissed; the posted filter shows only posted", () => {
    expect(matchesQueueFilter("all", "posted")).toBe(false);
    expect(matchesQueueFilter("all", "dismissed")).toBe(false);
    expect(matchesQueueFilter("posted", "posted")).toBe(true);
    expect(matchesQueueFilter("posted", "approved")).toBe(false);
  });
});

describe("bucketRank", () => {
  it("orders needs_input < ready < approved < dismissed", () => {
    expect(bucketRank("needs_input")).toBeLessThan(bucketRank("ready"));
    expect(bucketRank("ready")).toBeLessThan(bucketRank("approved"));
    expect(bucketRank("approved")).toBeLessThan(bucketRank("dismissed"));
  });
  it("sorts a mixed list so attention-needing rows lead, stably", () => {
    // Tag each bucket with an index to assert stability within a bucket.
    const rows = [
      { bucket: "approved" as const, i: 0 },
      { bucket: "needs_input" as const, i: 1 },
      { bucket: "ready" as const, i: 2 },
      { bucket: "needs_input" as const, i: 3 },
      { bucket: "dismissed" as const, i: 4 },
      { bucket: "ready" as const, i: 5 },
    ];
    const sorted = [...rows].sort(
      (a, b) => bucketRank(a.bucket) - bucketRank(b.bucket),
    );
    expect(sorted.map((r) => r.bucket)).toEqual([
      "needs_input",
      "needs_input",
      "ready",
      "ready",
      "approved",
      "dismissed",
    ]);
    // Stable: original order preserved within each bucket.
    expect(sorted.map((r) => r.i)).toEqual([1, 3, 2, 5, 0, 4]);
  });
  it("ranks every known bucket", () => {
    for (const b of QUEUE_BUCKETS) expect(typeof bucketRank(b)).toBe("number");
  });
});

// The regression this locks in: a queue whose only drafts are already settled
// (posted/dismissed) must probe NO connection — the connection behind a settled
// draft may be legitimately retired, and probing it showed a permanent false
// "reconnect" banner with nothing left to post.
describe("queueHealthScopes", () => {
  const row = (clientId: string | null, status: string | null) => ({
    clientId,
    status,
  });

  it("returns no scopes when every draft is settled", () => {
    expect(
      queueHealthScopes([
        row("c1", "posted"),
        row("c2", "dismissed"),
        row(null, "posted"),
      ]),
    ).toEqual([]);
  });

  it("covers only clients with drafts awaiting action, deduped", () => {
    expect(
      queueHealthScopes([
        row("c1", "draft"),
        row("c1", "approved"),
        row("c2", "posted"),
        row("c3", "approved"),
      ]),
    ).toEqual(["c1", "c3"]);
  });

  it("adds the firm-level scope only for an OPEN client-less row", () => {
    expect(queueHealthScopes([row(null, "draft"), row("c1", "draft")])).toEqual(
      ["c1", undefined],
    );
    expect(queueHealthScopes([row(null, "posted"), row("c1", "draft")])).toEqual(
      ["c1"],
    );
  });

  it("treats an unknown/absent status as open (matches the queue buckets)", () => {
    expect(queueHealthScopes([row("c1", null), row("c2", "whatever")])).toEqual(
      ["c1", "c2"],
    );
  });
});
