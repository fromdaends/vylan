import { describe, it, expect } from "vitest";
import {
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
