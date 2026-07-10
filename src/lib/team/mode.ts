export type LeaveTeamCheck =
  | { ok: true }
  | { ok: false; reason: "team_has_members" | "team_has_invites" };

// A team can only be turned off while it is genuinely a one-person team. This
// keeps "Leave team" non-destructive: no teammate loses access and no pending
// invitation silently becomes unusable.
export function canLeaveTeam(input: {
  activeMemberCount: number;
  pendingInviteCount: number;
}): LeaveTeamCheck {
  if (input.activeMemberCount > 1) {
    return { ok: false, reason: "team_has_members" };
  }
  if (input.pendingInviteCount > 0) {
    return { ok: false, reason: "team_has_invites" };
  }
  return { ok: true };
}
