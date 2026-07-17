import { describe, it, expect } from "vitest";
import {
  enrichActivityEntries,
  summarizeContributors,
  type ActivityEntry,
} from "./activity";

function entry(
  partial: Partial<ActivityEntry> & { id: string; action: string },
): ActivityEntry {
  return {
    id: partial.id,
    firm_id: partial.firm_id ?? "firm-1",
    engagement_id: partial.engagement_id ?? null,
    actor_type: partial.actor_type ?? "user",
    actor_id: partial.actor_id ?? null,
    action: partial.action,
    metadata: partial.metadata ?? {},
    created_at: partial.created_at ?? "2026-07-16T00:00:00Z",
  };
}

const engById = new Map([
  [
    "eng-1",
    { id: "eng-1", title: "2024 Personal Tax", client_id: "client-1" },
  ],
]);
const clientById = new Map([
  ["client-1", { id: "client-1", display_name: "Tremblay, Marie" }],
  ["client-2", { id: "client-2", display_name: "Acme Corp" }],
]);
const userById = new Map([
  [
    "user-1",
    {
      id: "user-1",
      name: "Jean Staff",
      display_name: "Jean",
      email: "jean@firm.ca",
    },
  ],
  [
    "user-2",
    { id: "user-2", name: null, display_name: null, email: "owner@firm.ca" },
  ],
]);

describe("enrichActivityEntries", () => {
  it("resolves engagement title + client via the engagement for engagement-scoped rows", () => {
    const [row] = enrichActivityEntries(
      [
        entry({
          id: "a1",
          action: "engagement_reassigned",
          engagement_id: "eng-1",
          actor_id: "user-1",
        }),
      ],
      engById,
      clientById,
      userById,
    );
    expect(row.engagement_title).toBe("2024 Personal Tax");
    expect(row.client_id).toBe("client-1");
    expect(row.client_display_name).toBe("Tremblay, Marie");
    // display_name wins over name/email
    expect(row.actor_name).toBe("Jean");
  });

  it("resolves the client from metadata.client_id for firm-wide rows with no engagement", () => {
    const [row] = enrichActivityEntries(
      [
        entry({
          id: "a2",
          action: "client_reassigned",
          engagement_id: null,
          actor_id: "user-2",
          metadata: { client_id: "client-2", to_user_id: "user-1" },
        }),
      ],
      engById,
      clientById,
      userById,
    );
    expect(row.engagement_title).toBeNull();
    expect(row.client_id).toBe("client-2");
    expect(row.client_display_name).toBe("Acme Corp");
    // falls back to email when display_name + name are null
    expect(row.actor_name).toBe("owner@firm.ca");
  });

  it("keeps the metadata client_id even when the client row wasn't fetched", () => {
    const [row] = enrichActivityEntries(
      [
        entry({
          id: "a3",
          action: "client_reassigned",
          engagement_id: null,
          metadata: { client_id: "client-404" },
        }),
      ],
      engById,
      clientById,
      userById,
    );
    expect(row.client_id).toBe("client-404");
    expect(row.client_display_name).toBeNull();
  });

  it("leaves client null when a non-engagement row has no metadata client_id", () => {
    const [row] = enrichActivityEntries(
      [
        entry({
          id: "a4",
          action: "data_export",
          engagement_id: null,
          actor_id: "user-1",
        }),
      ],
      engById,
      clientById,
      userById,
    );
    expect(row.client_id).toBeNull();
    expect(row.client_display_name).toBeNull();
    expect(row.engagement_title).toBeNull();
  });
});

describe("summarizeContributors", () => {
  const row = (
    actor_id: string | null,
    created_at: string,
    actor_type = "user",
  ) => ({ actor_type, actor_id, created_at });

  it("collapses to distinct users, newest-first, with counts", () => {
    const out = summarizeContributors([
      row("u-a", "2026-07-03T00:00:00Z"),
      row("u-b", "2026-07-02T00:00:00Z"),
      row("u-a", "2026-07-01T00:00:00Z"),
    ]);
    expect(out.map((c) => c.userId)).toEqual(["u-a", "u-b"]);
    expect(out[0]).toMatchObject({ userId: "u-a", lastAt: "2026-07-03T00:00:00Z", count: 2 });
    expect(out[1]).toMatchObject({ userId: "u-b", count: 1 });
  });

  it("ignores client + system rows and null actors", () => {
    const out = summarizeContributors([
      row("u-a", "2026-07-03T00:00:00Z"),
      row(null, "2026-07-02T00:00:00Z", "client"),
      row("u-x", "2026-07-02T00:00:00Z", "system"),
      row(null, "2026-07-01T00:00:00Z", "user"),
    ]);
    expect(out.map((c) => c.userId)).toEqual(["u-a"]);
  });

  it("returns empty for no user activity", () => {
    expect(summarizeContributors([])).toEqual([]);
  });
});
