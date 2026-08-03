import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  STAFF_CAPABILITIES,
  can,
  capabilitiesFor,
  isCapability,
  type Capability,
  type CapabilitySubject,
} from "./capabilities";

const owner: CapabilitySubject = { role: "owner" };
const staff: CapabilitySubject = { role: "staff" };

describe("the two ranks", () => {
  it("gives the owner everything", () => {
    for (const c of CAPABILITIES) expect(can(owner, c)).toBe(true);
  });

  it("gives staff the floor and nothing else", () => {
    const set = capabilitiesFor(staff);
    expect([...set].sort()).toEqual([...STAFF_CAPABILITIES].sort());
  });

  it("nests: owner ⊇ staff, and it is a real step", () => {
    const o = capabilitiesFor(owner);
    const s = capabilitiesFor(staff);
    for (const c of s) expect(o.has(c)).toBe(true);
    expect(o.size).toBeGreaterThan(s.size);
  });

  it("keeps firm administration off the staff floor", () => {
    for (const c of [
      "team.manage",
      "billing.manage",
      "firm.settings",
      "clients.private",
      "integrations.manage",
      "audit.view",
    ] as const) {
      expect(can(staff, c)).toBe(false);
    }
  });

  it("keeps the activity log to the owner", () => {
    // Reversed after PR #1044. The model briefly said staff could read it,
    // which contradicted the shipped app.
    expect(can(owner, "audit.view")).toBe(true);
    expect(can(staff, "audit.view")).toBe(false);
  });

  it("puts time approval on nobody's floor — it is granted", () => {
    expect(can(staff, "time.approve")).toBe(false);
  });

  it("answers no for a rank that is neither owner nor staff", () => {
    // Not reachable through the schema, but a bad cast or a future enum value
    // must land on the FLOOR, never on everything.
    expect(can({ role: "superuser" }, "team.manage")).toBe(false);
    expect(can({ role: "superuser" }, "billing.manage")).toBe(false);
  });
});

// ── MEMBER / JUNIOR ARE GONE ─────────────────────────────────────────────────
//
// The founder deleted the presets. These pin the two things that could have
// gone wrong in doing so: somebody losing access they had, and a leftover
// database value still steering the answer.
describe("removing the presets moved nobody", () => {
  it("keeps exactly what an untouched staff member had", () => {
    // Every staff row in every firm read as the old "member" preset unless an
    // owner had changed it, and member carried these two.
    expect(can(staff, "money.view")).toBe(true);
    expect(can(staff, "clients.manage")).toBe(true);
  });

  it("IGNORES a leftover permission_preset column value entirely", () => {
    // users.permission_preset is still in the database, unread. A row left
    // saying "junior" must not restrict anybody — that value no longer means
    // anything, and honouring it would be the preset system surviving its own
    // deletion.
    const leftover = {
      role: "staff" as const,
      permission_preset: "junior",
    } as CapabilitySubject & { permission_preset: string };
    expect(can(leftover, "money.view")).toBe(true);
    expect(can(leftover, "clients.manage")).toBe(true);
  });

  it("never lets any stored value demote the actual owner", () => {
    // Locking an owner out of their own firm has no recovery path in the UI.
    const demoted = {
      role: "owner" as const,
      permission_preset: "junior",
      extra_capabilities: [],
      role_capabilities: [],
    } as CapabilitySubject & { permission_preset: string };
    expect(can(demoted, "team.manage")).toBe(true);
    for (const c of CAPABILITIES) expect(can(demoted, c)).toBe(true);
  });
});

describe("grants and roles both add", () => {
  it("adds one capability without touching the rest of the floor", () => {
    const approver: CapabilitySubject = {
      role: "staff",
      extra_capabilities: ["time.approve"],
    };
    expect(can(approver, "time.approve")).toBe(true);
    expect(can(approver, "team.manage")).toBe(false);
    // Floor intact.
    expect(can(approver, "money.view")).toBe(true);
  });

  it("unions a role's capabilities with a person's own grants", () => {
    const both: CapabilitySubject = {
      role: "staff",
      extra_capabilities: ["billing.manage"],
      role_capabilities: ["integrations.manage"],
    };
    expect(can(both, "billing.manage")).toBe(true);
    expect(can(both, "integrations.manage")).toBe(true);
    expect(can(both, "team.manage")).toBe(false);
  });

  it("ignores a grant string that is not a capability", () => {
    // A rolled-back feature or a renamed capability must not break every page
    // the person opens.
    const subject: CapabilitySubject = {
      role: "staff",
      extra_capabilities: ["not.a.capability", ""],
      role_capabilities: ["also.not.real"],
    };
    expect(capabilitiesFor(subject).has("not.a.capability" as Capability)).toBe(
      false,
    );
    expect(can(subject, "money.view")).toBe(true);
  });

  it("does not mutate the shared staff set", () => {
    // capabilitiesFor returns the floor's own Set when there is nothing to add;
    // a grant must copy it, or one granted user rewrites the floor for the
    // whole process.
    can(
      { role: "staff", extra_capabilities: ["billing.manage"] },
      "billing.manage",
    );
    expect(can(staff, "billing.manage")).toBe(false);
  });

  it("treats empty lists as nothing to add", () => {
    expect(
      capabilitiesFor({
        role: "staff",
        extra_capabilities: [],
        role_capabilities: [],
      }),
    ).toBe(capabilitiesFor(staff));
  });
});

describe("can", () => {
  it("answers no for a signed-out request rather than throwing", () => {
    for (const c of CAPABILITIES) {
      expect(can(null, c)).toBe(false);
      expect(can(undefined, c)).toBe(false);
    }
  });
});

describe("the vocabulary itself", () => {
  it("has no duplicate capability names", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("recognises exactly the listed names", () => {
    for (const c of CAPABILITIES) expect(isCapability(c)).toBe(true);
    for (const junk of ["", "money", "money.View", null, undefined, 7, {}]) {
      expect(isCapability(junk)).toBe(false);
    }
  });

  it("names every capability owner.group.action style", () => {
    // Keeps grep useful: `grep '"money\.' ` should find the whole money story.
    for (const c of CAPABILITIES) expect(c).toMatch(/^[a-z]+\.[a-z]+$/);
  });

  it("puts every floor capability in the vocabulary", () => {
    for (const c of STAFF_CAPABILITIES) expect(isCapability(c)).toBe(true);
  });
});

// ── THE MIGRATION SAFETY NET ─────────────────────────────────────────────────
//
// Converting the remaining inline `role === "owner"` checks to can() is only
// safe while those two things mean EXACTLY the same for the capability being
// substituted. These pin that equivalence, so a change that would quietly widen
// an already-converted call site fails here instead of in production.
//
// Delete a line from OWNER_ONLY_TODAY only when the corresponding call sites
// are deliberately being opened up — never to make a red test go green.
describe("owner-only equivalence (guards the call-site migration)", () => {
  const OWNER_ONLY_TODAY: Capability[] = [
    "billing.manage",
    "firm.settings",
    "team.manage",
    "clients.private",
    "integrations.manage",
    // Owner-only since #1044 reversed the decision to open it.
    "audit.view",
  ];

  it("each behaves exactly like role === 'owner' for both real ranks", () => {
    for (const c of OWNER_ONLY_TODAY) {
      expect(can({ role: "owner" }, c)).toBe(true);
      expect(can({ role: "staff" }, c)).toBe(false);
    }
  });

  it("does NOT include capabilities that have no gate today", () => {
    // money.view and clients.manage are ungated in the app right now, so a
    // `role === "owner"` check must NEVER be converted to one of them — that
    // would ADD a restriction inside a release that claims to change nothing.
    for (const c of ["money.view", "clients.manage"] as const) {
      expect(OWNER_ONLY_TODAY).not.toContain(c);
    }
  });

  it("payments maps to billing.manage, never money.view", () => {
    // The specific trap: the /settings payments section spans the firm's own
    // subscription AND client payment collection. Mapping it to money.view
    // (which every staff member has) would open the payments tab to all staff
    // inside a release that claims to change nothing.
    expect(can({ role: "staff" }, "billing.manage")).toBe(false);
    expect(can({ role: "staff" }, "money.view")).toBe(true);
  });
});

// ── THE WIRING TEST ──────────────────────────────────────────────────────────
//
// The bug this exists to prevent, caught during Phase 2 and worth a permanent
// guard: CapabilitySubject's field was named `grants` while the database column
// is `extra_capabilities`. Passing a real user row into can() therefore read it
// as undefined — every stored grant silently ignored, and the per-person
// switches would have written to the database and changed nothing at all.
// Nothing failed; it just quietly did not work.
describe("a real users row is a valid subject", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "u-1",
    firm_id: "f-1",
    email: "a@b.c",
    name: "Ash",
    role: "staff" as const,
    locale: "en" as const,
    display_name: null,
    avatar_path: null,
    deactivated_at: null,
    deactivated_by_user_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("honours a stored grant straight off the row", () => {
    const manager = row({ extra_capabilities: ["billing.manage"] });
    expect(can(manager, "billing.manage")).toBe(true);
    expect(can(manager, "team.manage")).toBe(false);
  });

  it("honours role capabilities straight off the row", () => {
    const wearer = row({ role_capabilities: ["integrations.manage"] });
    expect(can(wearer, "integrations.manage")).toBe(true);
  });

  it("behaves as today when migration 1120 has not been applied", () => {
    // extra_capabilities comes back undefined. That must read as "the floor",
    // not as "restricted" — otherwise deploying before the migration would
    // quietly take access away from every staff member in every firm.
    const before = row();
    expect(can(before, "money.view")).toBe(true);
    expect(can(before, "clients.manage")).toBe(true);
    expect(can(before, "billing.manage")).toBe(false);
  });
});
