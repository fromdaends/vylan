import { describe, it, expect } from "vitest";
import { buildTeamChatSummary, countTeamUnreadForUser } from "./team-messages";

// PURE unread logic for the team group chat: messages from OTHERS newer than my
// last-read stamp; my own messages never count.
describe("countTeamUnreadForUser", () => {
  const me = "u-me";
  const other = "u-other";
  const msgs = [
    { sender_user_id: other, created_at: "2026-07-24T10:00:00Z" },
    { sender_user_id: me, created_at: "2026-07-24T11:00:00Z" },
    { sender_user_id: other, created_at: "2026-07-24T12:00:00Z" },
    { sender_user_id: null, created_at: "2026-07-24T13:00:00Z" }, // departed author
  ];

  it("counts only OTHERS' messages newer than my last-read", () => {
    expect(countTeamUnreadForUser(msgs, "2026-07-24T11:30:00Z", me)).toBe(2);
  });

  it("never counts my own messages", () => {
    // My 11:00 message is after a 10:30 cutoff but is mine → not counted; the
    // two others' messages (12:00, 13:00) are.
    expect(countTeamUnreadForUser(msgs, "2026-07-24T10:30:00Z", me)).toBe(2);
  });

  it("null last-read (never opened) counts every other-authored message", () => {
    expect(countTeamUnreadForUser(msgs, null, me)).toBe(3);
  });

  it("returns 0 when everything is read", () => {
    expect(countTeamUnreadForUser(msgs, "2026-07-25T00:00:00Z", me)).toBe(0);
  });

  it("from the other user's view, MY messages are the unread ones", () => {
    expect(countTeamUnreadForUser(msgs, null, other)).toBe(2); // my 11:00 + the null-author 13:00
  });
});

// PURE fold behind the pinned team conversation in the Messages inbox:
// newest-first rows + the viewer's read stamp → last-message preview + unread.
describe("buildTeamChatSummary", () => {
  const me = "u-me";
  const other = "u-other";
  // Newest-first, as the DB returns them.
  const msgs = [
    {
      sender_user_id: other,
      sender_name: "Zach",
      body: "Ping — the T2 is ready",
      created_at: "2026-07-24T12:00:00Z",
    },
    {
      sender_user_id: me,
      sender_name: "Tyler",
      body: "On it",
      created_at: "2026-07-24T11:00:00Z",
    },
  ];

  it("previews the newest message and flags whether it's mine", () => {
    const s = buildTeamChatSummary(msgs, null, me);
    expect(s.lastMessage).toEqual({
      body: "Ping — the T2 is ready",
      senderName: "Zach",
      mine: false,
      createdAt: "2026-07-24T12:00:00Z",
    });
    expect(s.unreadCount).toBe(1);
  });

  it("marks the preview mine from the author's own view", () => {
    // Zach wrote the newest message — from Zach's view it's his ("You: "),
    // and only Tyler's 11:00 message is unread for him.
    const s = buildTeamChatSummary(msgs, null, other);
    expect(s.lastMessage?.mine).toBe(true);
    expect(s.unreadCount).toBe(1);
  });

  it("returns a null preview and zero unread for an empty thread", () => {
    expect(buildTeamChatSummary([], null, me)).toEqual({
      lastMessage: null,
      unreadCount: 0,
    });
  });

  it("read stamp clears unread but keeps the preview", () => {
    const s = buildTeamChatSummary(msgs, "2026-07-25T00:00:00Z", me);
    expect(s.unreadCount).toBe(0);
    expect(s.lastMessage?.body).toBe("Ping — the T2 is ready");
  });
});
