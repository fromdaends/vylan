import { describe, it, expect } from "vitest";
import { can, capabilitiesFor } from "./capabilities";
import { GRANTABLE_CAPABILITIES, isGrantable } from "./grantable";

// The rule the founder asked about and did not have an answer to: how a role's
// permissions meet the Member / Junior switch. The preset is the FLOOR; roles
// stack on top; nothing a role does can take anything away.
describe("roles stack on top of the preset", () => {
  it("adds to a Junior without changing what Junior means", () => {
    const junior = { role: "staff", permission_preset: "junior" };
    expect(can(junior, "billing.manage")).toBe(false);

    const juniorWithRole = { ...junior, role_capabilities: ["billing.manage"] };
    expect(can(juniorWithRole, "billing.manage")).toBe(true);
    // Everything else about being a Junior is untouched.
    expect(can(juniorWithRole, "money.view")).toBe(can(junior, "money.view"));
    expect(can(juniorWithRole, "team.manage")).toBe(false);
  });

  it("cannot take away what the preset already gave", () => {
    // There is no way to express "this role removes X" — an empty role list is
    // simply no addition. If a future change made roles subtractive, this test
    // is the one that should stop it.
    const member = { role: "staff", permission_preset: "member" };
    const withEmptyRole = { ...member, role_capabilities: [] as string[] };
    expect(capabilitiesFor(withEmptyRole)).toEqual(capabilitiesFor(member));
  });

  it("unions per-person grants and role grants rather than one winning", () => {
    const subject = {
      role: "staff",
      permission_preset: "junior",
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
      permission_preset: "member",
      role_capabilities: ["nonsense.capability"],
    };
    expect(() => capabilitiesFor(subject)).not.toThrow();
    expect(capabilitiesFor(subject)).toEqual(
      capabilitiesFor({ role: "staff", permission_preset: "member" }),
    );
  });

  it("leaves an owner exactly as they were", () => {
    const owner = { role: "owner", permission_preset: "owner" };
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

  it("accepts the two that are vetted", () => {
    expect(GRANTABLE_CAPABILITIES).toEqual([
      "billing.manage",
      "integrations.manage",
    ]);
    for (const c of GRANTABLE_CAPABILITIES) expect(isGrantable(c)).toBe(true);
  });
});
