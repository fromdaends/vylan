import { describe, it, expect } from "vitest";
import { canDeactivateMember } from "./deactivation";

describe("canDeactivateMember", () => {
  it("allows deactivating another staff member", () => {
    expect(
      canDeactivateMember({
        targetId: "u2",
        targetRole: "staff",
        currentUserId: "u1",
        activeOwnerCount: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("blocks deactivating yourself", () => {
    expect(
      canDeactivateMember({
        targetId: "u1",
        targetRole: "owner",
        currentUserId: "u1",
        activeOwnerCount: 1,
      }),
    ).toEqual({ ok: false, reason: "cannot_deactivate_self" });
  });

  it("blocks deactivating the only owner", () => {
    expect(
      canDeactivateMember({
        targetId: "u2",
        targetRole: "owner",
        currentUserId: "u1",
        activeOwnerCount: 1,
      }),
    ).toEqual({ ok: false, reason: "cannot_deactivate_only_owner" });
  });

  it("allows deactivating an owner when another owner remains", () => {
    expect(
      canDeactivateMember({
        targetId: "u2",
        targetRole: "owner",
        currentUserId: "u1",
        activeOwnerCount: 2,
      }),
    ).toEqual({ ok: true });
  });

  it("the self-check wins even for a staff self-target", () => {
    expect(
      canDeactivateMember({
        targetId: "u1",
        targetRole: "staff",
        currentUserId: "u1",
        activeOwnerCount: 1,
      }),
    ).toEqual({ ok: false, reason: "cannot_deactivate_self" });
  });
});
