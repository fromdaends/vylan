// Pure guards for deactivating a firm member. Removing a teammate is a soft
// "deactivate" (never a hard delete) so the audit trail + historical names
// survive. Two rules: you can't deactivate yourself, and you can't deactivate
// the firm's only owner (transfer ownership first). Enforced in the server
// action; this is the testable core + the source of the UI's disabled states.

export type DeactivateCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "cannot_deactivate_self" | "cannot_deactivate_only_owner";
    };

export function canDeactivateMember(input: {
  targetId: string;
  targetRole: "owner" | "staff";
  currentUserId: string;
  // Number of ACTIVE owners in the firm (normally 1).
  activeOwnerCount: number;
}): DeactivateCheck {
  if (input.targetId === input.currentUserId) {
    return { ok: false, reason: "cannot_deactivate_self" };
  }
  if (input.targetRole === "owner" && input.activeOwnerCount <= 1) {
    return { ok: false, reason: "cannot_deactivate_only_owner" };
  }
  return { ok: true };
}
