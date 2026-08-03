// WHO IS ALLOWED TO DO WHAT — one place, one answer.
//
// Today the app asks `user.role === "owner"` in 98 different spots across 68
// files (plus 122 more reads of an `isOwner` prop derived from it). Every one
// of those is a separate copy of a policy decision, which is why the ladder had
// already gone crooked in places — a junior could open something a member
// couldn't, and two screens disagreed about the same button.
//
// This module replaces that question with `can(user, "money.view")`. Nothing
// calls it yet: this ships the chokepoint and its tests first, so converting
// call sites afterwards is a mechanical diff that can be reviewed a few files
// at a time instead of one 68-file bang.
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────
//
// The DATABASE keeps two ranks and only two, forever: 'owner' and 'staff'.
// Adding a third would mean re-deciding every RLS policy in the schema, and RLS
// is what actually protects the data — see the private-client rules in 0810.
//
// PRESETS sit on top, in application code: Owner, Member, Junior. They are
// named bundles of capabilities, not database rows, so renaming or re-cutting
// one is a code change with tests, not a migration.
//
// GRANTS are the escape hatch: a single extra capability handed to one person
// ("Sarah also approves timesheets") without inventing a rank for it. Phase 8's
// time approver is exactly this, which is why the parameter exists now — the
// old two-value ladder in lib/auth/roles.ts could not express it, and that is
// the assumption this module is built to break.
//
// ── ORDER MATTERS ────────────────────────────────────────────────────────────
//
// Owner ⊃ Member ⊃ Junior. That containment is asserted in the tests, because
// the one genuinely dangerous bug here is a fallback that resolves UP: treat an
// unrecognised preset as "member" and a typo in the database silently PROMOTES
// a junior. Unknown values resolve to the most restrictive preset instead.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//
// It is not a security boundary on its own. RLS is. `can()` decides what the UI
// shows and what a server action refuses early; the database decides what rows
// exist. Two of the capabilities below are deliberately NOT RLS-backed yet, and
// say so at their definition.

export const CAPABILITIES = [
  // ── Firm administration ───────────────────────────────────────────────────
  // Invite, deactivate, change someone's rank. NOT RLS-backed: every write in
  // app/actions/team.ts goes through the service-role client, so this check is
  // the only gate there is. And firm_invites_select_owner (RLS) is literally
  // owner-only, so granting this to a non-owner today would hand them a manage
  // screen with a permanently empty invite list. Owner-only until that lands.
  "team.manage",
  // The firm's Vylan subscription, plus the Stripe/PayPal setup for collecting
  // client payments. This is the capability the /settings "payments" section
  // maps to — NOT money.view. Getting that mapping backwards would open the
  // payments tab to all staff inside a release that claims to change nothing.
  "billing.manage",
  // Firm-wide policy: privacy defaults, assignment emails, document handling,
  // whether the AI may act, timezone.
  "firm.settings",

  // ── Reading the firm's work ───────────────────────────────────────────────
  // Invoice amounts, payment status, revenue figures.
  "money.view",
  // Create, archive, and re-own clients.
  "clients.manage",
  // See clients and engagements marked private. RLS-backed and RLS-decided —
  // engagement_is_private() in 0810 is the real gate. This exists so the UI can
  // stop rendering controls the database will refuse anyway.
  "clients.private",
  // The activity log at /settings/audit. OWNER-ONLY.
  //
  // This carried the opposite comment until now, and it was wrong — a stale
  // belief left in the model after the app reversed it. It read "open to Member
  // and Junior: the log answers what happened to this file, which is the
  // question staff ask". The founder rejected that (PR #1044) and the objection
  // was never client privacy, which is what that reasoning answered. It is that
  // a feed of everything one teammate did should not be readable by their
  // colleagues. That is surveillance of the firm's own staff, and per-viewer
  // row filtering does nothing about it.
  //
  // Left uncorrected, this was a live trap: converting the audit page's inline
  // check to can(user, "audit.view") would have silently RE-OPENED the log to
  // every member inside a release claiming to change nothing. The owner-only
  // equivalence test is what caught it.
  "audit.view",

  // ── Bookkeeping ───────────────────────────────────────────────────────────
  // Connect and disconnect QuickBooks / Xero / Sage. Filed under bookkeeping,
  // not firm administration, on purpose: it is plumbing for the books, and a
  // bookkeeper is a plausible holder of it in a way they are not for billing or
  // team management. Grouping it with firm-admin would have meant a firm could
  // not hand it over without handing over the subscription too.
  "integrations.manage",

  // ── Named grants ──────────────────────────────────────────────────────────
  // Approve a teammate's submitted time (Phase 8). No preset carries it: it is
  // granted per person. Listed now so the type exists before the feature does.
  "time.approve",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// The three presets, most privileged first. Order is load-bearing: the tests
// assert each one is a subset of the one before it.
export const PRESETS = ["owner", "member", "junior"] as const;
export type Preset = (typeof PRESETS)[number];

// The most restrictive preset — where anything unrecognised lands.
export const FALLBACK_PRESET: Preset = "junior";

// What each preset can do.
//
// MEMBER is calibrated to today's behaviour exactly, so converting call sites
// changes nothing visible. money.view and clients.manage have no gate anywhere
// in the app right now; they are listed as member capabilities to KEEP it that
// way. (That also means Phase 2 is not a pure refactor — it introduces two
// gates that did not exist. Junior is where they start to bite.)
const PRESET_CAPABILITIES: Record<Preset, readonly Capability[]> = {
  owner: CAPABILITIES,
  member: ["money.view", "clients.manage"],
  // Junior: does the work and stays out of the money. Deliberately NOT a third
  // database rank — a preset, so a firm can move someone between Junior and
  // Member without touching users.role.
  //
  // EMPTY, and that is correct rather than an oversight: everything a Junior
  // does today — opening work, uploading, completing — is ungated in the app,
  // so there is no capability to name for it. A Junior is defined by what they
  // CANNOT do. The first entry here will be Phase 8's time.approve, as a named
  // grant rather than a preset member.
  junior: [],
};

// Pre-built sets so `can()` is a hash lookup rather than a scan of an array.
const PRESET_SETS: Record<Preset, ReadonlySet<Capability>> = {
  owner: new Set(PRESET_CAPABILITIES.owner),
  member: new Set(PRESET_CAPABILITIES.member),
  junior: new Set(PRESET_CAPABILITIES.junior),
};

export function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    (CAPABILITIES as readonly string[]).includes(value)
  );
}

export function isPreset(value: unknown): value is Preset {
  return (
    typeof value === "string" && (PRESETS as readonly string[]).includes(value)
  );
}

// The person a capability question is about. Deliberately a plain shape rather
// than the full user row: `can()` must stay pure and testable without a
// database, and the callers already have these three fields.
export type CapabilitySubject = {
  // users.role — the database rank. Two values, forever.
  role: "owner" | "staff" | (string & {});
  // ⚠️ THESE NAMES MATCH THE users COLUMNS EXACTLY, and that is the point. They
  // were `preset` and `grants` until an AppUser was first passed straight into
  // can() — at which case both read as undefined, every stored preset was
  // silently ignored, and the switches would have written to the database while
  // changing nothing. Naming the fields after the row means an AppUser IS a
  // valid subject with no mapping step to forget.
  //
  // Optional because migration 1120 may not be applied: undefined behaves
  // exactly like null, which resolves to the member preset.
  permission_preset?: string | null;
  // users.extra_capabilities — per-person grants on top of the preset.
  extra_capabilities?: readonly string[] | null;
  // Everything this person's FIRM ROLES grant (1260), already unioned by
  // getCurrentUser. Not a users column — hence the different naming shape from
  // the two above, which deliberately mirror theirs.
  //
  // ROLES ONLY EVER ADD. There is no way to express "this role takes X away",
  // and that is a decision rather than an omission: two systems that can both
  // grant and revoke gives a firm two answers to "why can she do that", which
  // is the exact mess the one-place-decides work escaped. The preset is the
  // floor, roles stack on top.
  role_capabilities?: readonly string[] | null;
};

// Which preset applies to this person.
//
// An OWNER is always the owner preset regardless of what the preset column
// says. The rank is the thing RLS enforces; letting a stale or wrong preset
// value demote an owner would lock them out of their own firm with no way back.
//
// A staff member with no preset stored is a Member. That is what "staff" has
// meant since the feature shipped, and it is what every existing row will read
// as before the backfill runs.
//
// A staff member with an UNRECOGNISED preset is a Junior, not a Member. This is
// the fail-closed direction and it is the whole reason this function exists
// instead of a cast: falling back to member would mean a typo in one database
// cell hands someone the money.
export function resolvePreset(subject: CapabilitySubject): Preset {
  if (subject.role === "owner") return "owner";
  const stored = subject.permission_preset;
  if (stored == null || stored === "") return "member";
  if (isPreset(stored)) {
    // "owner" in the preset column on a staff row is not a promotion — the rank
    // is what RLS reads, and the row would fail every owner-only policy while
    // the UI showed owner controls. Treat it as unrecognised.
    return stored === "owner" ? FALLBACK_PRESET : stored;
  }
  console.error(
    `[capabilities] unrecognised permission preset ${JSON.stringify(stored)} — falling back to "${FALLBACK_PRESET}"`,
  );
  return FALLBACK_PRESET;
}

// Everything this person can do, preset plus named grants.
export function capabilitiesFor(
  subject: CapabilitySubject,
): ReadonlySet<Capability> {
  const preset = resolvePreset(subject);
  const base = PRESET_SETS[preset];
  const grants = subject.extra_capabilities;
  const fromRoles = subject.role_capabilities;
  const hasGrants = grants && grants.length > 0;
  const hasRoles = fromRoles && fromRoles.length > 0;
  if (!hasGrants && !hasRoles) return base;
  const merged = new Set(base);
  // Per-person grants, then role grants. Union, never subtraction — see the
  // note on role_capabilities above.
  for (const g of [...(grants ?? []), ...(fromRoles ?? [])]) {
    // Unknown grant strings are ignored, not thrown on. A grant that stops
    // existing (renamed capability, rolled-back feature) must not break every
    // page the person opens — it just stops granting anything.
    if (isCapability(g)) merged.add(g);
  }
  return merged;
}

// The question every call site should be asking.
//
// A missing subject is a signed-out request. Answer no rather than throwing:
// the caller is a page or a server action that has its own redirect for that,
// and a capability check is not where auth should blow up.
export function can(
  subject: CapabilitySubject | null | undefined,
  capability: Capability,
): boolean {
  if (!subject) return false;
  return capabilitiesFor(subject).has(capability);
}
