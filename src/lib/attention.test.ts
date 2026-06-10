import { describe, it, expect } from "vitest";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
  isCollectionComplete,
  deriveEngagementStatus,
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
    archived_at: null,
    archived_by_user_id: null,
    deleted_at: null,
    deleted_by_user_id: null,
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
    ai_rejection_count: 0,
    kind: "collection",
    signing_doc_path: null,
    signing_doc_name: null,
    signing_doc_mime: null,
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

  it("does NOT flag stale when fully collected, even if quiet", () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    const r = computeAttention({
      engagement: eng({
        sent_at: new Date(
          NOW.getTime() - 10 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
      items: [item({ status: "submitted" }), item({ status: "approved" })],
      lastClientActivityAt: sixDaysAgo.toISOString(),
      now: NOW,
    });
    expect(r.completionPct).toBe(1);
    expect(r.reasons).not.toContain("stale");
  });

  it("never flags a zero-document engagement, even when quiet 10+ days", () => {
    const r = computeAttention({
      engagement: eng({
        sent_at: new Date(
          NOW.getTime() - 10 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
      items: [],
      lastClientActivityAt: null,
      now: NOW,
    });
    expect(r.reasons).toEqual([]);
    expect(r.itemsTotal).toBe(0);
    expect(r.completionPct).toBe(1);
  });

  it("never flags a zero-document engagement, even when overdue", () => {
    const r = computeAttention({
      engagement: eng({ due_date: "2026-05-01" }), // before NOW
      items: [],
      lastClientActivityAt: null,
      now: NOW,
    });
    expect(r.reasons).toEqual([]);
    expect(r.daysOverdue).toBeNull();
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

  it("false when any required item is truly pending (no upload yet)", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "submitted" }), item({ status: "pending" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(isReadyToReview(r)).toBe(false);
  });

  it("true when an AI-bounced required item is the only thing 'pending'", () => {
    // Client uploaded → AI rejected → item reopened (status=pending) with
    // rejection_reason set. From the accountant's perspective there's
    // something to look at (and possibly override), so the engagement
    // should surface in 'Ready to review' rather than disappear.
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "submitted" }),
        item({
          status: "pending",
          rejection_reason: "Image was too dark to read.",
        }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsPendingRequired).toBe(0);
    expect(r.itemsReadyToReview).toBe(2); // submitted + ai-bounced
    expect(isReadyToReview(r)).toBe(true);
  });

  it("true when EVERY required item was AI-bounced (no clean submit yet)", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "pending", rejection_reason: "Blurry." }),
        item({ status: "pending", rejection_reason: "Wrong year." }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsPendingRequired).toBe(0);
    expect(r.itemsReadyToReview).toBe(2);
    expect(isReadyToReview(r)).toBe(true);
  });

  it("false when a truly-pending required item sits alongside an AI-bounced one", () => {
    // One item the client hasn't touched at all + one AI-bounced. The
    // engagement isn't 'ready' because the firm is still waiting on the
    // untouched item.
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "pending" }), // truly waiting on client
        item({ status: "pending", rejection_reason: "Cut off." }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsPendingRequired).toBe(1);
    expect(isReadyToReview(r)).toBe(false);
  });

  it("false when a REQUIRED item was rejected and awaits the client's replacement", () => {
    // The accountant sent a file back: the client owes a re-upload, so the
    // ball is in the client's court even though another file awaits review.
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "submitted" }), item({ status: "rejected" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsRequiredBlocked).toBe(1);
    expect(isReadyToReview(r)).toBe(false);
  });

  it("true when every required item is approved (parked until Mark complete)", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "approved" }),
        item({ status: "na" }),
        item({ status: "pending", required: false }), // untouched optional
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(isReadyToReview(r)).toBe(true);
  });

  it("zero-required engagement: ready once any optional submission awaits a decision", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "submitted", required: false }),
        item({ status: "pending", required: false }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(isReadyToReview(r)).toBe(true);
  });

  it("zero-required engagement: NOT ready while nothing awaits a decision", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "pending", required: false })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(isReadyToReview(r)).toBe(false);
  });
});

describe("deriveEngagementStatus (the unified status every surface reads)", () => {
  const readyAttention = () =>
    computeAttention({
      engagement: eng({ status: "in_progress" }),
      items: [
        item({ status: "approved" }),
        item({ status: "approved" }),
        item({ status: "submitted" }),
        item({ status: "pending", required: false }),
        item({ status: "pending", required: false }),
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });

  it("re-reads a live engagement as ready_to_review (the David Chen case)", () => {
    // 3 required all in (2 approved, 1 awaiting decision), 2 optionals
    // untouched: header pill, table pill, and sidebar must ALL say ready.
    const a = readyAttention();
    expect(a.completionPct).toBe(1);
    expect(deriveEngagementStatus("in_progress", a)).toBe("ready_to_review");
    expect(deriveEngagementStatus("sent", a)).toBe("ready_to_review");
  });

  it("keeps the stored status when the client still owes something", () => {
    const a = computeAttention({
      engagement: eng({ status: "in_progress" }),
      items: [item({ status: "submitted" }), item({ status: "pending" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(deriveEngagementStatus("in_progress", a)).toBe("in_progress");
  });

  it("never overrides draft / complete / cancelled", () => {
    const a = readyAttention();
    expect(deriveEngagementStatus("draft", a)).toBe("draft");
    expect(deriveEngagementStatus("complete", a)).toBe("complete");
    expect(deriveEngagementStatus("cancelled", a)).toBe("cancelled");
  });
});

describe("itemsUploaded + isCollectionComplete (client finished, AI-independent)", () => {
  it("counts every item with a file behind it, regardless of the AI verdict", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [
        item({ status: "approved" }),
        item({ status: "submitted" }),
        item({ status: "rejected" }),
        item({ status: "pending", rejection_reason: "Blurry." }), // AI-bounced
        item({ status: "na" }), // marked not applicable — no file
        item({ status: "pending" }), // truly waiting on the client
      ],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    // approved + submitted + rejected + AI-bounced = 4 (na + pending excluded)
    expect(r.itemsUploaded).toBe(4);
  });

  it("fires once the AI has APPROVED every upload (engagement also parks in Ready to review)", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "approved" }), item({ status: "approved" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsPendingRequired).toBe(0);
    expect(r.itemsReadyToReview).toBe(0); // nothing awaiting a per-file decision
    // Unified status engine: all required approved => stays Ready to review
    // (with the Mark complete affordance) until the accountant completes it.
    expect(isReadyToReview(r)).toBe(true);
    expect(r.itemsUploaded).toBe(2);
    expect(isCollectionComplete(r)).toBe(true); // the client IS done
  });

  it("fires even when the AI REJECTED every upload", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "rejected" }), item({ status: "rejected" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsPendingRequired).toBe(0);
    expect(isCollectionComplete(r)).toBe(true);
  });

  it("does NOT fire when nothing was uploaded (every item marked N/A)", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "na" }), item({ status: "na" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsUploaded).toBe(0);
    expect(isCollectionComplete(r)).toBe(false);
  });

  it("does NOT fire while a required item is still waiting on the client", () => {
    const r = computeAttention({
      engagement: eng(),
      items: [item({ status: "approved" }), item({ status: "pending" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.itemsPendingRequired).toBe(1);
    expect(isCollectionComplete(r)).toBe(false);
  });

  it("does NOT fire for a non-live engagement even if every item is approved", () => {
    const r = computeAttention({
      engagement: eng({ status: "complete" }),
      items: [item({ status: "approved" }), item({ status: "approved" })],
      lastClientActivityAt: NOW.toISOString(),
      now: NOW,
    });
    expect(r.isLive).toBe(false);
    expect(isCollectionComplete(r)).toBe(false);
  });
});
