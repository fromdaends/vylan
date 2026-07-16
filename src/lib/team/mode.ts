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

// Team UI — the sidebar's team section, engagement assignment, and the "Mine"
// filters — follows the firm's EXPLICIT team switch (firm.team_enabled).
//
// The old rule ALSO required a second active member. That made a firm that
// turned team mode ON but hadn't had an invite accepted yet see nothing change
// — "I created a team and none of it shows up". The switch is the opt-in: once
// it's on, the team surfaces appear (you can already assign work to yourself
// and it's ready for teammates), and turning it back off hides them again. A
// firm that is genuinely one-person can still Leave team — canLeaveTeam gates
// that on being a real solo team (no other members, no pending invites).
export function hasActiveTeam(input: {
  teamEnabled: boolean;
  // Kept for call-site compatibility; no longer part of the decision (the
  // explicit switch is the source of truth).
  activeMemberCount: number;
}): boolean {
  return input.teamEnabled;
}
