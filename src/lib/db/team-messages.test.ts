import { describe, it, expect } from "vitest";
import { countTeamUnreadForUser } from "./team-messages";

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
