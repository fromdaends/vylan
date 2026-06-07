// Pure guard for transferring firm ownership. The new owner must be an ACTIVE
// staff member of the same firm (and not yourself). Enforced in the server
// action; this is the testable core + drives which members the UI offers.

export type TransferCheck = { ok: true } | { ok: false; reason: "invalid_target" };

export function canTransferOwnershipTo(input: {
  targetId: string;
  targetRole: "owner" | "staff";
  targetDeactivated: boolean;
  currentUserId: string;
  targetSameFirm: boolean;
}): TransferCheck {
  if (
    !input.targetSameFirm ||
    input.targetId === input.currentUserId ||
    input.targetRole !== "staff" ||
    input.targetDeactivated
  ) {
    return { ok: false, reason: "invalid_target" };
  }
  return { ok: true };
}
