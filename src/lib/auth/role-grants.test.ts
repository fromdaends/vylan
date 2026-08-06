import { describe, it, expect } from "vitest";
import { can, capabilitiesFor } from "./capabilities";
import { GRANTABLE_CAPABILITIES, isGrantable } from "./grantable";

// How a role's permissions meet the rest of the model, now that Member/Junior
// are gone. The STAFF FLOOR is the floor; roles stack on top; nothing a role
// does can take anything away.
describe("roles stack on top of the staff floor", () => {
  it("adds to a staff member without changing the floor", () => {
    const staff = { role: "staff" };
    expect(can(staff, "billing.manage")).toBe(false);

    const withRole = { ...staff, role_capabilities: ["billing.manage"] };
    expect(can(withRole, "billing.manage")).toBe(true);
    // Everything else about being staff is untouched.
    expect(can(withRole, "money.view")).toBe(can(staff, "money.view"));
    expect(can(withRole, "team.manage")).toBe(false);
  });

  it("cannot take away what the floor already gave", () => {
    // There is no way to express "this role removes X" — an empty role list is
    // simply no addition. If a future change made roles subtractive, this test
    // is the one that should stop it.
    const staff = { role: "staff" };
    const withEmptyRole = { ...staff, role_capabilities: [] as string[] };
    expect(capabilitiesFor(withEmptyRole)).toEqual(capabilitiesFor(staff));
  });

  it("unions per-person grants and role grants rather than one winning", () => {
    const subject = {
      role: "staff",
      extra_capabilities: ["integrations.manage"],
      role_capabilities: ["billing.manage"],
    };
    expect(can(subject, "integrations.manage")).toBe(true);
    expect(can(subject, "billing.manage")).toBe(true);
  });

  it("ignores an unknown grant instead of throwing", () => {
    // A capability that stops existing — renamed, or a rolled-back feature —
    // must not break every page the person opens.
    const subject = {
      role: "staff",
      role_capabilities: ["nonsense.capability"],
    };
    expect(() => capabilitiesFor(subject)).not.toThrow();
    expect(capabilitiesFor(subject)).toEqual(capabilitiesFor({ role: "staff" }));
  });

  it("leaves an owner exactly as they were", () => {
    const owner = { role: "owner" };
    const ownerWithRole = { ...owner, role_capabilities: ["billing.manage"] };
    expect(capabilitiesFor(ownerWithRole)).toEqual(capabilitiesFor(owner));
  });
});

describe("what a role may grant", () => {
  it("refuses anything off the vetted list", () => {
    // The browser sends this. team.manage is a REAL capability, and handing it
    // out through a role would route around every reason it is owner-only.
    expect(isGrantable("team.manage")).toBe(false);
    expect(isGrantable("audit.view")).toBe(false);
    expect(isGrantable("clients.private")).toBe(false);
    expect(isGrantable("firm.settings")).toBe(false);
    expect(isGrantable("nonsense")).toBe(false);
    expect(isGrantable(null)).toBe(false);
  });

  it("accepts exactly the vetted list", () => {
    // This is the LOCK: widening what a role can grant must break this test so
    // it is done deliberately, in a diff a reviewer sees, never as a side
    // effect. The 1750 additions are the founder's own ruling ("roles only")
    // and are RLS-backed via current_user_has_capability().
    expect(GRANTABLE_CAPABILITIES).toEqual([
      "billing.manage",
      "integrations.manage",
      "rates.manage",
      "insights.view",
      "time.manage",
    ]);
    for (const c of GRANTABLE_CAPABILITIES) expect(isGrantable(c)).toBe(true);
  });

  it("grants the three time/insights capabilities through a role", () => {
    // The full chain the founder asked for: a staff member wearing a
    // "Senior manager" role holds the money-side capabilities without being an
    // owner, and a plain staff member holds none of them.
    const staff = { role: "staff" };
    expect(can(staff, "rates.manage")).toBe(false);
    expect(can(staff, "insights.view")).toBe(false);
    expect(can(staff, "time.manage")).toBe(false);

    const senior = {
      role: "staff",
      role_capabilities: ["rates.manage", "insights.view", "time.manage"],
    };
    expect(can(senior, "rates.manage")).toBe(true);
    expect(can(senior, "insights.view")).toBe(true);
    expect(can(senior, "time.manage")).toBe(true);

    // An owner needs no grant — the rank resolves to everything.
    expect(can({ role: "owner" }, "rates.manage")).toBe(true);
    expect(can({ role: "owner" }, "insights.view")).toBe(true);
    expect(can({ role: "owner" }, "time.manage")).toBe(true);
  });
});
