import { describe, it, expect } from "vitest";
import type { FileAiInput } from "@/lib/engagements/file-ai-headline";
import type { DocType } from "@/lib/db/templates";
import type { ResolvedRange } from "./range";
import {
  aggregateAi,
  aggregateMoney,
  type AiCandidate,
  type PaidInvoice,
} from "./aggregate";

const NOW = Date.parse("2026-07-21T23:03:00Z");

// ── AI ──────────────────────────────────────────────────────────────────────

function file(
  usable: boolean,
  review_status: "approved" | "rejected",
): FileAiInput {
  return {
    ai_classification: "t4",
    ai_confidence: 0.9,
    ai_usability: { usable },
    ai_rejected: false,
    ai_extracted_fields: {},
    review_status,
    uploaded_at: "2026-07-20T12:00:00Z",
  };
}

function scored(
  usable: boolean,
  decision: "approved" | "rejected",
): AiCandidate {
  return {
    analyzed: true,
    aiEnabled: true,
    scorable: {
      file: file(usable, decision),
      expectedDocType: "t4" as DocType,
      engagementTitle: "Smith — T4 slips",
      clientName: null,
      rejectionCount: 0,
      decision,
    },
  };
}

const aiOff: AiCandidate = { analyzed: false, aiEnabled: false, scorable: null };
const notRun: AiCandidate = { analyzed: false, aiEnabled: true, scorable: null };

describe("aggregateAi", () => {
  it("tallies the four cases and computes the agreement rate", () => {
    const candidates: AiCandidate[] = [
      scored(true, "approved"), // true_pass
      scored(true, "approved"), // true_pass
      scored(true, "rejected"), // false_pass
      scored(false, "rejected"), // true_catch
      scored(false, "approved"), // false_alarm
      aiOff,
      aiOff,
      notRun,
    ];
    const s = aggregateAi(candidates, NOW);
    expect(s.cases).toEqual({
      true_pass: 2,
      true_catch: 1,
      false_pass: 1,
      false_alarm: 1,
    });
    expect(s.assessedCount).toBe(5);
    expect(s.agreementCount).toBe(3); // 2 true_pass + 1 true_catch
    expect(s.agreementRate).toBeCloseTo(0.6, 10);
    expect(s.skippedAiOffCount).toBe(2);
    expect(s.notAnalyzedCount).toBe(1);
    expect(s.earlyData).toBe(true); // 5 < 20
  });

  it("returns a null rate (not a 0%) when nothing was assessed", () => {
    const s = aggregateAi([aiOff, notRun], NOW);
    expect(s.assessedCount).toBe(0);
    expect(s.agreementRate).toBeNull();
    expect(s.skippedAiOffCount).toBe(1);
    expect(s.notAnalyzedCount).toBe(1);
  });
});

// ── Money ─────────────────────────────────────────────────────────────────────

const RANGE: ResolvedRange = {
  range: "last_3_months",
  startMs: Date.parse("2026-05-01T04:00:00Z"),
  endMs: NOW,
  startIso: "2026-05-01T04:00:00.000Z",
  endIso: new Date(NOW).toISOString(),
  granularity: "month",
};

function paid(
  cents: number,
  createdIso: string,
  paidIso: string,
  locks: boolean,
): PaidInvoice {
  return {
    amountCents: cents,
    createdAtMs: Date.parse(createdIso),
    paidAtMs: Date.parse(paidIso),
    locksDeliverables: locks,
  };
}

describe("aggregateMoney", () => {
  it("sums collected, buckets by month, and averages time-to-paid", () => {
    const rows = [
      paid(10000, "2026-05-05T12:00:00Z", "2026-05-10T12:00:00Z", false),
      paid(20000, "2026-06-10T12:00:00Z", "2026-06-15T12:00:00Z", true),
      paid(30000, "2026-06-27T12:00:00Z", "2026-07-02T12:00:00Z", false),
    ];
    const s = aggregateMoney(rows, [{ amountCents: 5000 }], RANGE, "cad");

    expect(s.collectedCents).toBe(60000);
    expect(s.collectedCount).toBe(3);
    expect(s.outstandingCents).toBe(5000);
    expect(s.outstandingCount).toBe(1);

    // Three monthly buckets, one per month, in order.
    expect(s.buckets.map((b) => b.cents)).toEqual([10000, 20000, 30000]);
    expect(s.buckets[0].start).toBe("2026-05-01T04:00:00.000Z");

    // Every invoice was paid 5 days after creation.
    expect(s.timeToPaid.avgDays).toBe(5);
    // Only 1 locked + 2 unlocked → below the 5-each minimum → no split.
    expect(s.timeToPaid.split).toBeNull();
  });

  it("shows the lock split only when both groups have 5+ paid invoices", () => {
    const rows: PaidInvoice[] = [];
    for (let i = 0; i < 5; i++) {
      // Locked: 5 days to pay. Unlocked: 10 days to pay.
      rows.push(paid(1000, "2026-06-01T12:00:00Z", "2026-06-06T12:00:00Z", true));
      rows.push(
        paid(1000, "2026-06-01T12:00:00Z", "2026-06-11T12:00:00Z", false),
      );
    }
    const s = aggregateMoney(rows, [], RANGE, "cad");
    expect(s.timeToPaid.split).not.toBeNull();
    expect(s.timeToPaid.split?.lockedAvgDays).toBe(5);
    expect(s.timeToPaid.split?.lockedCount).toBe(5);
    expect(s.timeToPaid.split?.unlockedAvgDays).toBe(10);
    expect(s.timeToPaid.split?.unlockedCount).toBe(5);
    expect(s.timeToPaid.avgDays).toBe(7.5);
  });

  it("returns a null time-to-paid when nothing was paid in range", () => {
    const s = aggregateMoney([], [{ amountCents: 9000 }], RANGE, "cad");
    expect(s.collectedCents).toBe(0);
    expect(s.timeToPaid.avgDays).toBeNull();
    expect(s.outstandingCents).toBe(9000);
  });
});
