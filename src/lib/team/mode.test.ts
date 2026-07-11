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
  it("never treats a solo account as an active team", () => {
    expect(hasActiveTeam({ teamEnabled: true, activeMemberCount: 1 })).toBe(
      false,
    );
  });

  it("requires the explicit team switch as well as multiple members", () => {
    expect(hasActiveTeam({ teamEnabled: false, activeMemberCount: 2 })).toBe(
      false,
    );
    expect(hasActiveTeam({ teamEnabled: true, activeMemberCount: 2 })).toBe(
      true,
    );
  });
});
