import { describe, it, expect } from "vitest";
import {
  buildFirmConversations,
  countUnreadForClient,
  countUnreadForFirm,
  isClientMessagingSchemaMissing,
  toPortalMessage,
} from "./client-messages";

describe("countUnreadForFirm", () => {
  const msgs = [
    { sender: "firm" as const, created_at: "2026-07-01T10:00:00Z" },
    { sender: "client" as const, created_at: "2026-07-01T11:00:00Z" },
    { sender: "client" as const, created_at: "2026-07-02T09:00:00Z" },
    { sender: "firm" as const, created_at: "2026-07-02T10:00:00Z" },
  ];

  it("counts every client message when the firm never read the thread", () => {
    expect(countUnreadForFirm(msgs, null)).toBe(2);
  });

  it("only counts client messages newer than the read pointer", () => {
    expect(countUnreadForFirm(msgs, "2026-07-01T12:00:00Z")).toBe(1);
  });

  it("never counts the firm's own messages", () => {
    // Read pointer before everything: both client messages count, the two
    // firm messages never do.
    expect(countUnreadForFirm(msgs, "2026-06-01T00:00:00Z")).toBe(2);
  });

  it("is zero when the pointer is at or past the newest client message", () => {
    expect(countUnreadForFirm(msgs, "2026-07-02T09:00:00Z")).toBe(0);
    expect(countUnreadForFirm([], null)).toBe(0);
  });
});

describe("countUnreadForClient", () => {
  const msgs = [
    { sender: "firm" as const, created_at: "2026-07-01T10:00:00Z" },
    { sender: "client" as const, created_at: "2026-07-01T11:00:00Z" },
    { sender: "firm" as const, created_at: "2026-07-02T10:00:00Z" },
  ];

  it("counts every firm message when the client never read the thread", () => {
    expect(countUnreadForClient(msgs, null)).toBe(2);
  });

  it("only counts firm messages newer than the read pointer, never the client's own", () => {
    expect(countUnreadForClient(msgs, "2026-07-01T12:00:00Z")).toBe(1);
    expect(countUnreadForClient(msgs, "2026-07-02T10:00:00Z")).toBe(0);
  });
});

describe("toPortalMessage", () => {
  it("strips internal user ids from the client-safe projection", () => {
    const projected = toPortalMessage({
      id: "m1",
      sender: "firm",
      sender_user_id: "internal-user-id",
      sender_name: "Zach",
      body: "Hello",
      created_at: "2026-07-01T10:00:00Z",
    });
    expect(projected).toEqual({
      id: "m1",
      sender: "firm",
      sender_name: "Zach",
      body: "Hello",
      created_at: "2026-07-01T10:00:00Z",
    });
    expect("sender_user_id" in projected).toBe(false);
  });
});

describe("isClientMessagingSchemaMissing", () => {
  it("matches the missing-relation/column codes only", () => {
    expect(isClientMessagingSchemaMissing({ code: "PGRST205" })).toBe(true);
    expect(isClientMessagingSchemaMissing({ code: "42P01" })).toBe(true);
    expect(isClientMessagingSchemaMissing({ code: "PGRST204" })).toBe(true);
    expect(isClientMessagingSchemaMissing({ code: "42703" })).toBe(true);
    expect(isClientMessagingSchemaMissing({ code: "23505" })).toBe(false);
    expect(isClientMessagingSchemaMissing(null)).toBe(false);
    expect(isClientMessagingSchemaMissing(undefined)).toBe(false);
  });
});

describe("buildFirmConversations", () => {
  const engagements = [
    {
      id: "e-live",
      title: "GST/QST 2026",
      status: "in_progress",
      clientName: "Acme Corp",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "e-draft",
      title: "Draft return",
      status: "draft",
      clientName: "Beta Inc",
      createdAt: "2026-02-01T00:00:00Z",
    },
    {
      id: "e-complete",
      title: "T1 2025",
      status: "complete",
      clientName: "Gamma Ltd",
      createdAt: "2026-03-01T00:00:00Z",
    },
    {
      id: "e-silent",
      title: "New mandate",
      status: "sent",
      clientName: "Delta Co",
      createdAt: "2026-06-01T00:00:00Z",
    },
  ];
  const threads = [
    { engagement_id: "e-live", firm_last_read_at: "2026-07-01T10:00:00Z" },
    { engagement_id: "e-complete", firm_last_read_at: null },
  ];
  // Newest-first, as the DB returns them.
  const messages = [
    {
      engagement_id: "e-live",
      sender: "client" as const,
      body: "Any update?",
      created_at: "2026-07-02T09:00:00Z",
    },
    {
      engagement_id: "e-live",
      sender: "firm" as const,
      body: "Working on it",
      created_at: "2026-07-01T09:00:00Z",
    },
    {
      engagement_id: "e-complete",
      sender: "firm" as const,
      body: "All done, thanks",
      created_at: "2026-06-15T12:00:00Z",
    },
    {
      engagement_id: "e-complete",
      sender: "client" as const,
      body: "Here are my docs",
      created_at: "2026-06-14T12:00:00Z",
    },
  ];

  it("includes live + threaded engagements, drops silent drafts, sorts by recency", () => {
    const rows = buildFirmConversations(engagements, threads, messages);
    // e-draft (draft, no thread) is excluded; the rest sort by last activity.
    expect(rows.map((r) => r.engagementId)).toEqual([
      "e-live",
      "e-complete",
      "e-silent",
    ]);
  });

  it("summarizes the last message and firm-unread per conversation", () => {
    const rows = buildFirmConversations(engagements, threads, messages);
    const live = rows.find((r) => r.engagementId === "e-live")!;
    expect(live.clientName).toBe("Acme Corp");
    expect(live.lastMessage).toEqual({
      sender: "client",
      body: "Any update?",
      createdAt: "2026-07-02T09:00:00Z",
    });
    // One client message after the 07-01 read pointer.
    expect(live.unreadCount).toBe(1);

    const complete = rows.find((r) => r.engagementId === "e-complete")!;
    // Newest message wins as the preview even though it's the firm's.
    expect(complete.lastMessage?.body).toBe("All done, thanks");
    // Read pointer null → the one client message counts as unread.
    expect(complete.unreadCount).toBe(1);
  });

  it("shows a live engagement with no messages as an empty, unread-free row", () => {
    const rows = buildFirmConversations(engagements, threads, messages);
    const silent = rows.find((r) => r.engagementId === "e-silent")!;
    expect(silent.lastMessage).toBeNull();
    expect(silent.unreadCount).toBe(0);
    // Falls back to the engagement's own timestamp for sorting.
    expect(silent.lastActivityAt).toBe("2026-06-01T00:00:00Z");
  });

  it("counts no unread once the firm read pointer passes the newest client message", () => {
    const readPast = [
      { engagement_id: "e-live", firm_last_read_at: "2026-07-03T00:00:00Z" },
    ];
    const rows = buildFirmConversations(
      engagements.filter((e) => e.id === "e-live"),
      readPast,
      messages.filter((m) => m.engagement_id === "e-live"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unreadCount).toBe(0);
  });
});
