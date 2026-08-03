import { describe, it, expect } from "vitest";
import { capabilityRows } from "./capability-sources";
import { CAPABILITIES, STAFF_CAPABILITIES } from "@/lib/auth/capabilities";

const row = (rows: ReturnType<typeof capabilityRows>, cap: string) =>
  rows.find((r) => r.capability === cap)!;

describe("capabilityRows", () => {
  it("returns one row per capability, in declaration order", () => {
    // The declared order groups by area (firm admin, reading the work,
    // bookkeeping, named grants). Re-sorting would scatter related permissions.
    const rows = capabilityRows({ role: "staff" });
    expect(rows.map((r) => r.capability)).toEqual([...CAPABILITIES]);
  });

  it("credits an owner's rank, not their badges", () => {
    // An owner has everything because of users.role. Reporting "from the
    // Bookkeeper role" for an owner who happens to wear that badge would be
    // true-ish and useless.
    const rows = capabilityRows(
      { role: "owner" },
      [{ name: "Bookkeeper", capabilities: ["integrations.manage"] }],
    );
    expect(rows.every((r) => r.allowed)).toBe(true);
    expect(rows.every((r) => r.source === "owner")).toBe(true);
  });

  it("calls the staff floor a preset, not a grant", () => {
    const rows = capabilityRows({ role: "staff" });
    for (const cap of STAFF_CAPABILITIES) {
      expect(row(rows, cap).allowed).toBe(true);
      expect(row(rows, cap).source).toBe("preset");
    }
  });

  it("names the role a permission arrives from", () => {
    const rows = capabilityRows({ role: "staff" }, [
      { name: "Bookkeeper", capabilities: ["integrations.manage"] },
      { name: "Reviewer", capabilities: [] },
    ]);
    // The set of allowed capabilities still comes from capabilitiesFor, so a
    // role that grants nothing to this subject can't fake an allow.
    expect(row(rows, "integrations.manage").roleNames).toEqual(["Bookkeeper"]);
  });

  it("prefers the ROLE over a personal grant when both carry it", () => {
    // If both carry it, removing the personal grant changes nothing — saying
    // "grant" would send an owner to the switch that won't help.
    const rows = capabilityRows(
      { role: "staff", extra_capabilities: ["integrations.manage"] },
      [{ name: "Bookkeeper", capabilities: ["integrations.manage"] }],
    );
    expect(row(rows, "integrations.manage").source).toBe("role");
  });

  it("reports a personal grant when no role carries it", () => {
    const rows = capabilityRows({
      role: "staff",
      extra_capabilities: ["integrations.manage"],
    });
    expect(row(rows, "integrations.manage").allowed).toBe(true);
    expect(row(rows, "integrations.manage").source).toBe("grant");
  });

  it("says none — never a source — for something they cannot do", () => {
    const rows = capabilityRows({ role: "staff" });
    expect(row(rows, "team.manage").allowed).toBe(false);
    expect(row(rows, "team.manage").source).toBe("none");
    expect(row(rows, "team.manage").roleNames).toEqual([]);
  });

  it("ignores a grant string that is no longer a real capability", () => {
    // A renamed capability or a rolled-back feature must not add a phantom row
    // or crash the page — it just stops granting anything.
    const rows = capabilityRows({
      role: "staff",
      extra_capabilities: ["nonsense.capability"],
    });
    expect(rows).toHaveLength(CAPABILITIES.length);
    expect(rows.filter((r) => r.source === "grant")).toEqual([]);
  });

  it("survives the pre-migration shape (no grants column at all)", () => {
    // Migration 1120 may be unapplied, in which case the column reads back
    // undefined — which must behave exactly like an empty list.
    expect(() => capabilityRows({ role: "staff", extra_capabilities: null }))
      .not.toThrow();
    expect(capabilityRows({ role: "staff", extra_capabilities: null })).toEqual(
      capabilityRows({ role: "staff" }),
    );
  });

  it("never marks a row allowed that can() would refuse", () => {
    // The allow/deny answer must always come from capabilitiesFor, so this
    // table can't drift from what the app actually enforces.
    const rows = capabilityRows({ role: "staff" }, [
      { name: "Liar", capabilities: [...CAPABILITIES] },
    ]);
    for (const r of rows) {
      if (!STAFF_CAPABILITIES.includes(r.capability)) {
        expect(r.allowed).toBe(false);
        expect(r.source).toBe("none");
      }
    }
  });
});
