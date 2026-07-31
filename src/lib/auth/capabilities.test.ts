import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CAPABILITIES,
  PRESETS,
  FALLBACK_PRESET,
  can,
  capabilitiesFor,
  isCapability,
  isPreset,
  resolvePreset,
  type Capability,
  type CapabilitySubject,
} from "./capabilities";

const owner: CapabilitySubject = { role: "owner" };
const member: CapabilitySubject = { role: "staff", permission_preset: "member" };
const junior: CapabilitySubject = { role: "staff", permission_preset: "junior" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the preset ladder", () => {
  it("nests: owner ⊇ member ⊇ junior", () => {
    const o = capabilitiesFor(owner);
    const m = capabilitiesFor(member);
    const j = capabilitiesFor(junior);
    for (const c of m) expect(o.has(c)).toBe(true);
    for (const c of j) expect(m.has(c)).toBe(true);
    // And each step is a real step, not an alias for the one above.
    expect(o.size).toBeGreaterThan(m.size);
    expect(m.size).toBeGreaterThan(j.size);
  });

  it("gives the owner everything", () => {
    for (const c of CAPABILITIES) expect(can(owner, c)).toBe(true);
  });

  it("keeps firm administration out of every staff preset", () => {
    for (const c of ["team.manage", "billing.manage", "firm.settings"] as const) {
      expect(can(member, c)).toBe(false);
      expect(can(junior, c)).toBe(false);
    }
  });

  it("keeps the money away from a junior but not a member", () => {
    expect(can(member, "money.view")).toBe(true);
    expect(can(junior, "money.view")).toBe(false);
    expect(can(member, "clients.manage")).toBe(true);
    expect(can(junior, "clients.manage")).toBe(false);
  });

  it("keeps the activity log to the owner", () => {
    // Reversed after PR #1044. The model said Member and Junior could read it,
    // which contradicted the shipped app — and would have silently re-opened
    // the log the moment the audit page's inline check was converted.
    expect(can(owner, "audit.view")).toBe(true);
    expect(can(member, "audit.view")).toBe(false);
    expect(can(junior, "audit.view")).toBe(false);
  });

  it("hands private clients to nobody but the owner", () => {
    expect(can(owner, "clients.private")).toBe(true);
    expect(can(member, "clients.private")).toBe(false);
    expect(can(junior, "clients.private")).toBe(false);
  });

  it("files integrations under bookkeeping, still owner-only for now", () => {
    // Grouped away from firm-admin so it can be handed to a bookkeeper later
    // without handing over billing. No staff preset carries it yet.
    expect(can(owner, "integrations.manage")).toBe(true);
    expect(can(member, "integrations.manage")).toBe(false);
  });

  it("puts time approval in no preset at all — it is a named grant", () => {
    expect(can(member, "time.approve")).toBe(false);
    expect(can(junior, "time.approve")).toBe(false);
  });
});

describe("resolvePreset", () => {
  it("treats a plain staff row as a member", () => {
    // Every existing row reads this way before the backfill runs, so this is
    // what makes converting call sites a no-op.
    expect(resolvePreset({ role: "staff" })).toBe("member");
    expect(resolvePreset({ role: "staff", permission_preset: null })).toBe("member");
    expect(resolvePreset({ role: "staff", permission_preset: "" })).toBe("member");
  });

  it("FAILS CLOSED on an unrecognised preset instead of promoting", () => {
    // The dangerous bug this whole function exists to prevent: falling back to
    // "member" would mean one typo in one database cell hands a junior the
    // money. Anything unknown lands on the most restrictive preset.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bogus of ["Member", "MEMBER", "limited", "admin", "  ", "1"]) {
      expect(resolvePreset({ role: "staff", permission_preset: bogus })).toBe(
        FALLBACK_PRESET,
      );
    }
    expect(log).toHaveBeenCalled();
    expect(can({ role: "staff", permission_preset: "membre" }, "money.view")).toBe(false);
  });

  it("refuses to promote a staff row whose preset column says owner", () => {
    // The rank is what RLS reads. A staff row calling itself an owner preset
    // would render owner controls that every database policy then rejects.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolvePreset({ role: "staff", permission_preset: "owner" })).toBe(
      FALLBACK_PRESET,
    );
    expect(log).not.toHaveBeenCalled(); // a known value, just not an allowed one
  });

  it("never lets a preset value demote the actual owner", () => {
    // Locking an owner out of their own firm has no recovery path in the UI.
    for (const stored of ["junior", "member", "nonsense", null, ""]) {
      expect(resolvePreset({ role: "owner", permission_preset: stored })).toBe("owner");
    }
    expect(can({ role: "owner", permission_preset: "junior" }, "team.manage")).toBe(true);
  });
});

describe("named grants", () => {
  it("adds one capability without changing the rest of the preset", () => {
    const approver: CapabilitySubject = {
      role: "staff",
      permission_preset: "junior",
      extra_capabilities: ["time.approve"],
    };
    expect(can(approver, "time.approve")).toBe(true);
    // Still a junior in every other respect — this is the point of a grant.
    expect(can(approver, "money.view")).toBe(false);
    expect(can(approver, "team.manage")).toBe(false);
  });

  it("ignores a grant string that is not a capability", () => {
    // A rolled-back feature or a renamed capability must not break every page
    // the person opens.
    const subject: CapabilitySubject = {
      role: "staff",
      extra_capabilities: ["not.a.capability", "", "money.view"],
    };
    expect(can(subject, "money.view")).toBe(true);
    expect(capabilitiesFor(subject).has("not.a.capability" as Capability)).toBe(
      false,
    );
  });

  it("does not mutate the shared preset set", () => {
    // capabilitiesFor returns the preset's own Set when there are no grants;
    // a grant must copy it, or one granted user rewrites the preset for the
    // whole process.
    can({ role: "staff", permission_preset: "junior", extra_capabilities: ["money.view"] }, "money.view");
    expect(can(junior, "money.view")).toBe(false);
  });

  it("treats an empty grant list as no grants", () => {
    expect(capabilitiesFor({ role: "staff", extra_capabilities: [] })).toBe(
      capabilitiesFor({ role: "staff" }),
    );
  });
});

describe("can", () => {
  it("answers no for a signed-out request rather than throwing", () => {
    for (const c of CAPABILITIES) {
      expect(can(null, c)).toBe(false);
      expect(can(undefined, c)).toBe(false);
    }
  });

  it("answers no for a rank that is neither owner nor staff", () => {
    // Not reachable through the schema, but a bad cast or a future enum value
    // must not fall through to something permissive.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(can({ role: "superuser", permission_preset: "root" }, "team.manage")).toBe(
      false,
    );
    expect(log).toHaveBeenCalled();
  });
});

describe("the vocabulary itself", () => {
  it("has no duplicate capability or preset names", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    expect(new Set(PRESETS).size).toBe(PRESETS.length);
  });

  it("recognises exactly the listed names", () => {
    for (const c of CAPABILITIES) expect(isCapability(c)).toBe(true);
    for (const p of PRESETS) expect(isPreset(p)).toBe(true);
    for (const junk of ["", "money", "money.View", null, undefined, 7, {}]) {
      expect(isCapability(junk)).toBe(false);
      expect(isPreset(junk)).toBe(false);
    }
  });

  it("names every capability owner.group.action style", () => {
    // Keeps grep useful: `grep '"money\.' ` should find the whole money story.
    for (const c of CAPABILITIES) expect(c).toMatch(/^[a-z]+\.[a-z]+$/);
  });
});

// ── THE MIGRATION SAFETY NET ─────────────────────────────────────────────────
//
// Converting ~98 inline `role === "owner"` checks to can() is only safe while
// those two things mean EXACTLY the same for every capability an owner-only
// check is being replaced by. These tests pin that equivalence, so a future
// change to a preset that would quietly widen an already-converted call site
// fails here instead of in production.
//
// Delete a line from OWNER_ONLY_TODAY only when the corresponding call sites
// are deliberately being opened up — never to make a red test go green.
describe("owner-only equivalence (guards the call-site migration)", () => {
  // Every capability that, TODAY, is granted to the owner and to nobody else.
  // A call site currently written `role === "owner"` may be converted to one of
  // these and behave identically.
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
      // The only two values users.role can hold. A staff row reads as `member`
      // until the preset column exists, which is what makes the conversion a
      // no-op on today's data.
      expect(can({ role: "owner" }, c)).toBe(true);
      expect(can({ role: "staff" }, c)).toBe(false);
      // ...and for every preset a staff row could resolve to, once it does.
      expect(can({ role: "staff", permission_preset: "member" }, c)).toBe(false);
      expect(can({ role: "staff", permission_preset: "junior" }, c)).toBe(false);
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
    // (which every member has) would open the payments tab to all staff inside
    // a release that claims to change nothing.
    expect(can({ role: "staff" }, "billing.manage")).toBe(false);
    expect(can({ role: "staff" }, "money.view")).toBe(true);
  });
});

// ── THE WIRING TEST ──────────────────────────────────────────────────────────
//
// The bug this exists to prevent, caught during Phase 2 and worth a permanent
// guard: CapabilitySubject's fields were named `preset` and `grants` while the
// database columns are `permission_preset` and `extra_capabilities`. Passing a
// real user row into can() therefore read BOTH as undefined — every stored
// preset silently ignored, and the per-person switches would have written to
// the database and changed nothing at all. Nothing failed; it just quietly did
// not work.
describe("a real users row is a valid subject", () => {
  // Shaped like AppUser, with the fields that matter spelled exactly as the
  // columns are. If someone renames either side, this stops compiling or fails.
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

  it("honours a stored preset straight off the row", () => {
    expect(can(row({ permission_preset: "junior" }), "money.view")).toBe(false);
    expect(can(row({ permission_preset: "member" }), "money.view")).toBe(true);
  });

  it("honours a stored grant straight off the row", () => {
    // The office-manager case: a Junior who may also manage billing.
    const approver = row({
      permission_preset: "junior",
      extra_capabilities: ["billing.manage"],
    });
    expect(can(approver, "billing.manage")).toBe(true);
    expect(can(approver, "money.view")).toBe(false);
  });

  it("behaves as today when migration 1120 has not been applied", () => {
    // Both columns come back undefined. That must read as "member", not as
    // "restricted" — otherwise deploying the code before the migration would
    // quietly take access away from every staff member in every firm.
    const before = row();
    expect(can(before, "money.view")).toBe(true);
    expect(can(before, "clients.manage")).toBe(true);
    expect(can(before, "billing.manage")).toBe(false);
  });
});
