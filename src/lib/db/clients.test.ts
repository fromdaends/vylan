import { describe, it, expect } from "vitest";
import { canReceiveClientAssignment } from "./clients";

describe("canReceiveClientAssignment", () => {
  const firmId = "firm-1";

  it("accepts an active member of the same firm", () => {
    expect(
      canReceiveClientAssignment(
        { firm_id: firmId, deactivated_at: null },
        firmId,
      ),
    ).toBe(true);
  });

  it("rejects a member of a different firm", () => {
    expect(
      canReceiveClientAssignment(
        { firm_id: "firm-2", deactivated_at: null },
        firmId,
      ),
    ).toBe(false);
  });

  it("rejects a deactivated member", () => {
    expect(
      canReceiveClientAssignment(
        { firm_id: firmId, deactivated_at: "2026-01-01T00:00:00Z" },
        firmId,
      ),
    ).toBe(false);
  });

  it("rejects a missing target", () => {
    expect(canReceiveClientAssignment(null, firmId)).toBe(false);
    expect(canReceiveClientAssignment(undefined, firmId)).toBe(false);
  });
});
