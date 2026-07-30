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
const member: CapabilitySubject = { role: "staff", preset: "member" };
const junior: CapabilitySubject = { role: "staff", preset: "junior" };

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

  it("gives the activity log to everyone, junior included", () => {
    // The ladder used to run backwards here: the log was owner-only while the
    // work it records was not. Both staff presets read it now.
    for (const who of [owner, member, junior]) {
      expect(can(who, "audit.view")).toBe(true);
    }
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
    expect(resolvePreset({ role: "staff", preset: null })).toBe("member");
    expect(resolvePreset({ role: "staff", preset: "" })).toBe("member");
  });

  it("FAILS CLOSED on an unrecognised preset instead of promoting", () => {
    // The dangerous bug this whole function exists to prevent: falling back to
    // "member" would mean one typo in one database cell hands a junior the
    // money. Anything unknown lands on the most restrictive preset.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bogus of ["Member", "MEMBER", "limited", "admin", "  ", "1"]) {
      expect(resolvePreset({ role: "staff", preset: bogus })).toBe(
        FALLBACK_PRESET,
      );
    }
    expect(log).toHaveBeenCalled();
    expect(can({ role: "staff", preset: "membre" }, "money.view")).toBe(false);
  });

  it("refuses to promote a staff row whose preset column says owner", () => {
    // The rank is what RLS reads. A staff row calling itself an owner preset
    // would render owner controls that every database policy then rejects.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolvePreset({ role: "staff", preset: "owner" })).toBe(
      FALLBACK_PRESET,
    );
    expect(log).not.toHaveBeenCalled(); // a known value, just not an allowed one
  });

  it("never lets a preset value demote the actual owner", () => {
    // Locking an owner out of their own firm has no recovery path in the UI.
    for (const stored of ["junior", "member", "nonsense", null, ""]) {
      expect(resolvePreset({ role: "owner", preset: stored })).toBe("owner");
    }
    expect(can({ role: "owner", preset: "junior" }, "team.manage")).toBe(true);
  });
});

describe("named grants", () => {
  it("adds one capability without changing the rest of the preset", () => {
    const approver: CapabilitySubject = {
      role: "staff",
      preset: "junior",
      grants: ["time.approve"],
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
      grants: ["not.a.capability", "", "money.view"],
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
    can({ role: "staff", preset: "junior", grants: ["money.view"] }, "money.view");
    expect(can(junior, "money.view")).toBe(false);
  });

  it("treats an empty grant list as no grants", () => {
    expect(capabilitiesFor({ role: "staff", grants: [] })).toBe(
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
    expect(can({ role: "superuser", preset: "root" }, "team.manage")).toBe(
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
