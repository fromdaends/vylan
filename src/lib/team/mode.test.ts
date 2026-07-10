import { describe, expect, it } from "vitest";
import { canLeaveTeam } from "./mode";

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
