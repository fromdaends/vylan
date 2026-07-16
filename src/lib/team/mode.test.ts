import { describe, expect, it } from "vitest";
import { canLeaveTeam, hasActiveTeam } from "./mode";

describe("canLeaveTeam", () => {
  it("allows the sole member to leave", () => {
    expect(
      canLeaveTeam({ activeMemberCount: 1, pendingInviteCount: 0 }),
    ).toEqual({ ok: true });
  });

  it("protects active teammates", () => {
    expect(
      canLeaveTeam({ activeMemberCount: 2, pendingInviteCount: 0 }),
    ).toEqual({ ok: false, reason: "team_has_members" });
  });

  it("requires pending invitations to be revoked first", () => {
    expect(
      canLeaveTeam({ activeMemberCount: 1, pendingInviteCount: 1 }),
    ).toEqual({ ok: false, reason: "team_has_invites" });
  });
});

describe("hasActiveTeam", () => {
  it("follows the explicit team switch — on even for a solo team-enabled firm", () => {
    // Turning team mode ON surfaces the team UI immediately, before a second
    // member joins. (The old rule hid everything until activeMemberCount > 1,
    // which read as "I created a team and none of it shows".)
    expect(hasActiveTeam({ teamEnabled: true, activeMemberCount: 1 })).toBe(
      true,
    );
    expect(hasActiveTeam({ teamEnabled: true, activeMemberCount: 2 })).toBe(
      true,
    );
  });

  it("is off whenever the switch is off, regardless of member count", () => {
    expect(hasActiveTeam({ teamEnabled: false, activeMemberCount: 1 })).toBe(
      false,
    );
    expect(hasActiveTeam({ teamEnabled: false, activeMemberCount: 2 })).toBe(
      false,
    );
  });
});
