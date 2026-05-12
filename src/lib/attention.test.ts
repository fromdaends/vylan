import { describe, it, expect } from "vitest";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
} from "./attention";
import type { Engagement } from "@/lib/db/engagements";
import type { RequestItem } from "@/lib/db/request-items";

const NOW = new Date("2026-05-15T12:00:00Z");

function eng(overrides: Partial<Engagement> = {}): Engagement {
  return {
    id: "e1",
    firm_id: "f1",
    client_id: "c1",
    title: "T1",
    type: "t1",
    status: "sent",
    due_date: null,
    sent_at: NOW.toISOString(),
    completed_at: null,
    magic_token: "t",
    magic_expires_at: null,
    assigned_user_id: null,
    reminders_paused: false,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

function item(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "i" + Math.random(),
    engagement_id: "e1",
    label: "X",
    label_fr: null,
    description: null,
    description_fr: null,
    doc_type: "t4",
    required: true,
    order_index: 0,
    status: "pending",
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("computeAttention", () => {
  it("flags overdue engagements", () => {
    const r = computeAttention({
      engagement: eng({ due_date: "2026-05-10" }),
      items: [item()],
      lastClientActivityAt: null,
      now: NOW,
    });
    expect(r.reasons).toContain("overdue");
    expect(r.daysOverdue).toBeGreaterThan(0);
  });

  it("flags due_soon when within 7 days AND <80% complete", () => {
    const r = computeAttention({
      engagement: eng({ due_date: "2026-05-20" }),
      items: [item(), item(), item({ status: "submitted" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.reasons).toContain("due_soon");
  });

  it("does NOT flag due_soon when already 80%+ done", () => {
    const r = computeAttention({
      engagement: eng({ due_date: "2026-05-20" }),
      items: [
        item({ status: "submitted" }),
        item({ status: "approved" }),
        item({ status: "submitted" }),
        item({ status: "na", required: false }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.reasons).not.toContain("due_soon");
  });

  it("flags stale when last activity is 5+ days ago", () => {
    const fiveDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    const r = computeAttention({
      engagement: eng({
        sent_at: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      items: [item()],
      lastClientActivityAt: fiveDaysAgo.toISOString(),
      now: NOW,
    });
    expect(r.reasons).toContain("stale");
  });

  it("never flags draft / complete / cancelled engagements", () => {
    for (const status of ["draft", "complete", "cancelled"] as const) {
      const r = computeAttention({
        engagement: eng({ status, due_date: "2026-05-01" }),
        items: [item()],
        lastClientActivityAt: null,
        now: NOW,
      });
      expect(r.reasons).toEqual([]);
    }
  });

  it("computes completion percentage from required items only", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "submitted" }),
        item({ status: "pending" }),
        item({ status: "submitted", required: false }), // optional, ignored
      ],
      lastClientActivityAt: null,
      now: NOW,
    });
    expect(r.itemsTotal).toBe(2);
    expect(r.itemsDone).toBe(1);
    expect(r.completionPct).toBeCloseTo(0.5);
  });
});

describe("attentionScore + sorting", () => {
  it("ranks overdue higher than stale", () => {
    const a = computeAttention({
      engagement: eng({ due_date: "2026-04-01" }),
      items: [item()],
      lastClientActivityAt: null,
      now: NOW,
    });
    const b = computeAttention({
      engagement: eng({
        sent_at: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      items: [item()],
      lastClientActivityAt: null,
      now: NOW,
    });
    expect(attentionScore(a)).toBeGreaterThan(attentionScore(b));
  });
});

describe("isReadyToReview", () => {
  it("true when all required items non-pending AND at least one submitted", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "submitted" }),
        item({ status: "submitted" }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(isReadyToReview(r)).toBe(true);
  });

  it("false when any required item is still pending", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "submitted" }), item({ status: "pending" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(isReadyToReview(r)).toBe(false);
  });
});
