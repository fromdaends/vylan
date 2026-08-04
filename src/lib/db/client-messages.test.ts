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
  // Every ACTIVE client earns a row since 1440 — the inbox is a contacts list,
  // not just the conversations already started.
  const clients = [
    { id: "c-acme", displayName: "Acme Corp" },
    { id: "c-beta", displayName: "Beta Inc" },
    { id: "c-gamma", displayName: "Gamma Ltd" },
    { id: "c-delta", displayName: "Delta Co" },
  ];
  const threads = [
    { client_id: "c-acme", firm_last_read_at: "2026-07-01T10:00:00Z" },
    { client_id: "c-gamma", firm_last_read_at: null },
  ];
  // Newest-first, as the DB returns them.
  const messages = [
    {
      client_id: "c-acme",
      sender: "client" as const,
      body: "Any update?",
      created_at: "2026-07-02T09:00:00Z",
    },
    {
      client_id: "c-acme",
      sender: "firm" as const,
      body: "Working on it",
      created_at: "2026-07-01T09:00:00Z",
    },
    {
      client_id: "c-gamma",
      sender: "firm" as const,
      body: "All done, thanks",
      created_at: "2026-06-15T12:00:00Z",
    },
    {
      client_id: "c-gamma",
      sender: "client" as const,
      body: "Here are my docs",
      created_at: "2026-06-14T12:00:00Z",
    },
  ];

  it("lists every active client, conversations first then the silent ones by name", () => {
    const rows = buildFirmConversations(clients, threads, messages);
    expect(rows.map((r) => r.clientId)).toEqual([
      // Real conversations, newest activity first...
      "c-acme",
      "c-gamma",
      // ...then never-messaged clients, alphabetically.
      "c-beta",
      "c-delta",
    ]);
  });

  it("summarizes the last message and firm-unread per client", () => {
    const rows = buildFirmConversations(clients, threads, messages);
    const acme = rows.find((r) => r.clientId === "c-acme")!;
    expect(acme.clientName).toBe("Acme Corp");
    expect(acme.lastMessage).toEqual({
      sender: "client",
      body: "Any update?",
      createdAt: "2026-07-02T09:00:00Z",
    });
    // One client message after the 07-01 read pointer.
    expect(acme.unreadCount).toBe(1);

    const gamma = rows.find((r) => r.clientId === "c-gamma")!;
    // Newest message wins as the preview even though it's the firm's.
    expect(gamma.lastMessage?.body).toBe("All done, thanks");
    // Read pointer null → the one client message counts as unread.
    expect(gamma.unreadCount).toBe(1);
  });

  it("shows a never-messaged client as an empty row with no timestamp", () => {
    const rows = buildFirmConversations(clients, threads, messages);
    const silent = rows.find((r) => r.clientId === "c-delta")!;
    expect(silent.lastMessage).toBeNull();
    expect(silent.unreadCount).toBe(0);
    // Not the client's created_at: there is no activity to date, so the row
    // shows none rather than implying a conversation that never happened.
    expect(silent.lastActivityAt).toBeNull();
  });

  it("folds every engagement's history into the client's one conversation", () => {
    // The same client wrote from two different engagement portals; 1440 means
    // that is ONE thread, and the newest message anywhere is the preview.
    const merged = buildFirmConversations(
      [{ id: "c-acme", displayName: "Acme Corp" }],
      [{ client_id: "c-acme", firm_last_read_at: null }],
      [
        {
          client_id: "c-acme",
          sender: "client" as const,
          body: "About the GST filing",
          created_at: "2026-07-02T09:00:00Z",
        },
        {
          client_id: "c-acme",
          sender: "client" as const,
          body: "And about the T2",
          created_at: "2026-05-02T09:00:00Z",
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.lastMessage?.body).toBe("About the GST filing");
    // Both count — they are one conversation, not two.
    expect(merged[0]!.unreadCount).toBe(2);
  });

  it("counts no unread once the firm read pointer passes the newest client message", () => {
    const rows = buildFirmConversations(
      clients.filter((c) => c.id === "c-acme"),
      [{ client_id: "c-acme", firm_last_read_at: "2026-07-03T00:00:00Z" }],
      messages.filter((m) => m.client_id === "c-acme"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unreadCount).toBe(0);
  });

  // Archiving is the "off the board" action: the client's whole conversation
  // goes, history included, and stops feeding the unread badge.
  describe("archived clients", () => {
    const archived = clients.map((c) =>
      c.id === "c-acme" ? { ...c, archivedAt: "2026-07-05T00:00:00Z" } : c,
    );

    it("drops an archived client's conversation, messages and all", () => {
      const rows = buildFirmConversations(archived, threads, messages);
      expect(rows.map((r) => r.clientId)).not.toContain("c-acme");
      expect(rows.map((r) => r.clientId)).toEqual([
        "c-gamma",
        "c-beta",
        "c-delta",
      ]);
    });

    it("takes the archived client's unread out of the badge total", () => {
      const before = buildFirmConversations(clients, threads, messages);
      const after = buildFirmConversations(archived, threads, messages);
      const total = (rows: { unreadCount: number }[]) =>
        rows.reduce((n, r) => n + r.unreadCount, 0);
      expect(total(before)).toBe(2);
      expect(total(after)).toBe(1);
    });

    it("brings the conversation back when the client is restored", () => {
      const restored = archived.map((c) =>
        c.id === "c-acme" ? { ...c, archivedAt: null } : c,
      );
      const rows = buildFirmConversations(restored, threads, messages);
      expect(rows.map((r) => r.clientId)).toContain("c-acme");
    });

    it("treats a missing stamp as not archived, never hiding a live thread", () => {
      // Undefined is what a read that didn't return the column produces — it
      // must fail OPEN.
      const rows = buildFirmConversations(clients, threads, messages);
      expect(rows.map((r) => r.clientId)).toContain("c-acme");
    });
  });
});
