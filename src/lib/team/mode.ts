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

// Assignment UI is useful only when there is another active teammate to
// assign work to. Requiring both the explicit team switch and two active
// members makes solo accounts robust against stale/incorrect database flags.
export function hasActiveTeam(input: {
  teamEnabled: boolean;
  activeMemberCount: number;
}): boolean {
  return input.teamEnabled && input.activeMemberCount > 1;
}
