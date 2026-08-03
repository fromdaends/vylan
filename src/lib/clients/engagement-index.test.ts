import { describe, it, expect } from "vitest";
import { buildClientEngagementIndex } from "./engagement-index";
import type { Engagement, EngagementStatus } from "@/lib/db/engagements";

// Only the fields the builder reads. Cast at the boundary so a 20-field
// engagement fixture isn't needed to assert a count.
function eng(
  over: Partial<Engagement> & { id: string; client_id: string },
): Engagement {
  return {
    title: `E-${over.id}`,
    type: "t1",
    status: "sent" as EngagementStatus,
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Engagement;
}

describe("buildClientEngagementIndex", () => {
  it("counts live work as sent + in_progress only", () => {
    // Draft is not yet real work and complete/cancelled are finished. If either
    // leaked into total_live, the row badge would tell an accountant a client
    // is busy when nothing is actually moving.
    const { summaries } = buildClientEngagementIndex([
      eng({ id: "a", client_id: "c1", status: "draft" }),
      eng({ id: "b", client_id: "c1", status: "sent" }),
      eng({ id: "c", client_id: "c1", status: "in_progress" }),
      eng({ id: "d", client_id: "c1", status: "complete" }),
      eng({ id: "e", client_id: "c1", status: "cancelled" }),
    ]);
    expect(summaries.c1).toEqual({
      draft: 1,
      sent: 1,
      in_progress: 1,
      complete: 1,
      cancelled: 1,
      total_live: 2,
    });
  });

  it("keeps each client's tallies separate", () => {
    const { summaries } = buildClientEngagementIndex([
      eng({ id: "a", client_id: "c1", status: "sent" }),
      eng({ id: "b", client_id: "c2", status: "sent" }),
      eng({ id: "c", client_id: "c2", status: "sent" }),
    ]);
    expect(summaries.c1.total_live).toBe(1);
    expect(summaries.c2.total_live).toBe(2);
  });

  it("puts the accountant's ball first in a client's drawer", () => {
    // ready_to_review leads, then in_progress / sent, then drafts, then
    // finished work. A ready engagement buried under three drafts is the whole
    // reason the rank exists.
    const derived = new Map<string, EngagementStatus | "ready_to_review">([
      ["ready", "ready_to_review"],
    ]);
    const { engagementsByClient } = buildClientEngagementIndex(
      [
        eng({ id: "done", client_id: "c1", status: "complete" }),
        eng({ id: "draft", client_id: "c1", status: "draft" }),
        eng({ id: "ready", client_id: "c1", status: "in_progress" }),
        eng({ id: "live", client_id: "c1", status: "in_progress" }),
      ],
      derived,
    );
    expect(engagementsByClient.c1.map((r) => r.id)).toEqual([
      "ready",
      "live",
      "draft",
      "done",
    ]);
  });

  it("falls back to the raw status when no derived status is given", () => {
    // A page that hasn't loaded attention signals passes no map at all; it must
    // still get a usable drawer rather than undefined pills.
    const { engagementsByClient } = buildClientEngagementIndex([
      eng({ id: "a", client_id: "c1", status: "sent" }),
    ]);
    expect(engagementsByClient.c1[0].status).toBe("sent");
  });

  it("takes the FIRST timestamp per client (input is newest first)", () => {
    const { lastActivityByClient } = buildClientEngagementIndex([
      eng({ id: "new", client_id: "c1", created_at: "2026-05-01T00:00:00Z" }),
      eng({ id: "old", client_id: "c1", created_at: "2020-01-01T00:00:00Z" }),
    ]);
    expect(lastActivityByClient.c1).toBe("2026-05-01T00:00:00Z");
  });

  it("returns empty maps for no engagements rather than throwing", () => {
    const index = buildClientEngagementIndex([]);
    expect(index.summaries).toEqual({});
    expect(index.engagementsByClient).toEqual({});
    expect(index.lastActivityByClient).toEqual({});
  });

  it("gives each client its own summary object", () => {
    // A shared object would make one client's counts follow another's — the
    // classic accumulator-aliasing bug, and silent.
    const { summaries } = buildClientEngagementIndex([
      eng({ id: "a", client_id: "c1", status: "sent" }),
      eng({ id: "b", client_id: "c2", status: "sent" }),
    ]);
    expect(summaries.c1).not.toBe(summaries.c2);
  });
});
