import { describe, it, expect } from "vitest";
import { canTransferOwnershipTo } from "./ownership";

const base = {
  targetId: "u2",
  targetRole: "staff" as const,
  targetDeactivated: false,
  currentUserId: "u1",
  targetSameFirm: true,
};

describe("canTransferOwnershipTo", () => {
  it("allows transferring to an active staff member of the same firm", () => {
    expect(canTransferOwnershipTo(base)).toEqual({ ok: true });
  });
  it("rejects transferring to yourself", () => {
    expect(canTransferOwnershipTo({ ...base, targetId: "u1" })).toEqual({
      ok: false,
      reason: "invalid_target",
    });
  });
  it("rejects an existing owner", () => {
    expect(canTransferOwnershipTo({ ...base, targetRole: "owner" })).toEqual({
      ok: false,
      reason: "invalid_target",
    });
  });
  it("rejects a deactivated member", () => {
    expect(
      canTransferOwnershipTo({ ...base, targetDeactivated: true }),
    ).toEqual({ ok: false, reason: "invalid_target" });
  });
  it("rejects someone from another firm", () => {
    expect(canTransferOwnershipTo({ ...base, targetSameFirm: false })).toEqual({
      ok: false,
      reason: "invalid_target",
    });
  });
});
