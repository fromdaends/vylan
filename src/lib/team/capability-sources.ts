import {
  CAPABILITIES,
  STAFF_CAPABILITIES,
  capabilitiesFor,
  isCapability,
  type Capability,
  type CapabilitySubject,
} from "@/lib/auth/capabilities";

// Not just WHETHER somebody can do a thing, but WHY.
//
// The permission switches already say what is on. What an owner actually asks
// standing on a teammate's page is "why can she do that" — and the answer is
// one of four different things, only one of which is a switch anybody flipped.
// Showing the state without the source is how a firm ends up toggling a switch
// that changes nothing because the permission arrives from a role.
//
// PURE (no I/O, no React) so the rules are unit-tested directly, and so the
// page stays a renderer.

export type CapabilitySource =
  // Their rank. Owners get everything, decided by users.role and nothing else.
  | "owner"
  // The staff floor — every member has these, no grant involved.
  | "preset"
  // A firm role they wear (1260).
  | "role"
  // Granted to this person specifically, under User access on their page.
  | "grant"
  // They don't have it.
  | "none";

export type CapabilityRow = {
  capability: Capability;
  allowed: boolean;
  source: CapabilitySource;
  // Which roles carry it, for the ones that come from a role. Empty otherwise.
  // Named, because "a role gives her this" is useless if you then have to open
  // every role to find which.
  roleNames: string[];
};

// One row per capability, in the order CAPABILITIES declares them — that order
// is grouped by area (firm admin, reading the work, bookkeeping, named grants)
// and re-sorting it here would scatter related permissions.
export function capabilityRows(
  subject: CapabilitySubject,
  // The roles this person WEARS, with what each one grants. Used only to name
  // the source; the allow/deny answer always comes from capabilitiesFor, so
  // this table can never disagree with what can() actually returns.
  heldRoles: readonly { name: string; capabilities: readonly string[] }[] = [],
): CapabilityRow[] {
  const allowedSet = capabilitiesFor(subject);
  const isOwner = subject.role === "owner";
  const staffFloor = new Set<string>(STAFF_CAPABILITIES);
  const personalGrants = new Set(
    (subject.extra_capabilities ?? []).filter(isCapability),
  );

  return CAPABILITIES.map((capability) => {
    const allowed = allowedSet.has(capability);
    const roleNames = heldRoles
      .filter((r) => r.capabilities.includes(capability))
      .map((r) => r.name);

    let source: CapabilitySource = "none";
    if (!allowed) {
      source = "none";
    } else if (isOwner) {
      // Checked FIRST and deliberately: an owner has everything because of
      // their rank, and reporting "from the Bookkeeper role" for an owner who
      // happens to wear that badge would be true-ish and useless.
      source = "owner";
    } else if (staffFloor.has(capability)) {
      source = "preset";
    } else if (roleNames.length > 0) {
      // Roles before personal grants: if both carry it, removing the personal
      // grant changes nothing, and saying "grant" would send an owner to the
      // switch that won't help.
      source = "role";
    } else if (personalGrants.has(capability)) {
      source = "grant";
    } else {
      // Allowed, but none of the four explanations fit — a capability added to
      // the staff floor without updating STAFF_CAPABILITIES, or a future
      // source. "preset" is the honest fallback: they have it without anyone
      // granting it.
      source = "preset";
    }

    return { capability, allowed, source, roleNames };
  });
}

// The i18n key for a capability's plain-English label.
//
// next-intl splits a key on "." to walk nested namespaces, so a key literally
// named `cap_team.manage` resolves as Team → cap_team → manage, misses, and
// renders the raw key on screen (which is exactly what shipped and had to be
// fixed). The capability ID keeps its dot; only the KEY flattens it.
export function capabilityLabelKey(capability: Capability): string {
  return `cap_${capability.replace(/\./g, "_")}`;
}
