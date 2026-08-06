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
// EVERYTHING ELSE IS ADDITIVE, from exactly two sources:
//
//   ROLES  — the owner names a role, attaches capabilities, and hands it out.
//            This is the switchboard.
//   GRANTS — one capability handed to one person without inventing a role for
//            them ("Sarah also approves timesheets"). The escape hatch, and it
//            lives on that person's own page under User access.
//
// ── MEMBER / JUNIOR ARE GONE ─────────────────────────────────────────────────
//
// There used to be a third source: named PRESETS (Owner / Member / Junior) with
// a segmented control on each person's page. The founder removed it — "get rid
// of member slash junior, get rid of that completely" — and the reason is the
// one that matters: the SAME two switches appeared both there and on a role,
// either could grant, and neither screen told you which one had. Two ways to
// answer one question is how the two screens end up disagreeing.
//
// What Member could do is now simply what STAFF can do, unchanged, so removing
// the presets moved nobody. Junior — the restrictive one — is not replaced:
// nothing in the app was gated on it (its capability set was empty), so no
// permission changed hands when it went. Restricting below the staff floor is a
// thing this model deliberately cannot express today; adding it back would mean
// subtraction, and subtraction is what made the old shape unreadable.
//
// users.permission_preset is left in the database, unread. Dropping a column is
// the founder's call, and a stale value that nothing consults is harmless.
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
  // NOTE: this is NOT part of the time-tracking build — that build explicitly
  // has no submission/approval workflow. It stays listed and stays inert.
  "time.approve",

  // ── Time tracking + Insights (migration 1750) ─────────────────────────────
  // The founder's ruling that shapes all three: "it should all be role
  // permission that are set though... roles only." None of these is gated on
  // the owner rank anywhere — not in the UI, not in the actions, and not in
  // RLS (which reads them through current_user_has_capability(), the SQL
  // mirror of this module).
  //
  // See and set what each team member costs per hour (user_rates). The
  // founder's own example of why this is a capability and not a rank: "billing
  // rates could be transferred over to, like, a senior manager who wants to
  // see how each person is being paid."
  "rates.manage",
  // The money picture: revenue, labour cost, estimated margin — the Insights
  // section. ⚠️ Anyone holding this can DERIVE a colleague's hourly rate
  // (margin is rate × hours, and division exists), so granting it is granting
  // rates-adjacent knowledge. The switch's description says so out loud.
  "insights.view",
  // Fix or remove a TEAMMATE'S time entry. Everyone edits their own without
  // any capability; this is the practice-manager grant for tidying the firm's
  // time. Deliberately separate from time.approve (inert, above): correcting a
  // typo is not an approval workflow.
  "time.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// THE STAFF FLOOR — what everybody who is not the owner starts with, before any
// role or grant adds to it.
//
// These two are exactly what the old Member preset carried, which is why
// deleting the presets moved nobody: money.view and clients.manage have no gate
// anywhere in the app today, and they are listed here to KEEP it that way.
// Converting a call site to can(user, "money.view") must not quietly take
// something away from the staff who have always had it.
export const STAFF_CAPABILITIES: readonly Capability[] = [
  "money.view",
  "clients.manage",
];

// THE OUTSIDER FLOOR — empty (migration 1300).
//
// An outside collaborator is restricted on the opposite axis from everybody
// else: they may need to do everything on one file, and are limited in which
// files exist for them at all. So the axis this module controls starts them at
// nothing, and a role or a grant is what hands them anything.
//
// Empty rather than the staff floor because the two staff capabilities are
// exactly the wrong ones to give a contractor by default: money.view is the
// firm's invoice amounts, and clients.manage creates and archives clients.
//
// This takes nothing away from anybody: no user has is_external until an owner
// invites one as an outsider, and the flag did not exist before 1300.
export const EXTERNAL_CAPABILITIES: readonly Capability[] = [];

// Pre-built sets so `can()` is a hash lookup rather than a scan of an array.
const OWNER_SET: ReadonlySet<Capability> = new Set(CAPABILITIES);
const STAFF_SET: ReadonlySet<Capability> = new Set(STAFF_CAPABILITIES);
const EXTERNAL_SET: ReadonlySet<Capability> = new Set(EXTERNAL_CAPABILITIES);

export function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" &&
    (CAPABILITIES as readonly string[]).includes(value)
  );
}

// The person a capability question is about. Deliberately a plain shape rather
// than the full user row: `can()` must stay pure and testable without a
// database, and the callers already have these three fields.
export type CapabilitySubject = {
  // users.role — the database rank. Two values, forever.
  role: "owner" | "staff" | (string & {});
  // ⚠️ THIS NAME MATCHES THE users COLUMN EXACTLY, and that is the point. It
  // was `grants` until an AppUser was first passed straight into can() — at
  // which point it read as undefined, every stored grant was silently ignored,
  // and the switches would have written to the database while changing nothing.
  // Naming the field after the row means an AppUser IS a valid subject with no
  // mapping step to forget.
  //
  // users.extra_capabilities — one person's own grants, set under User access
  // on their page. Optional because migration 1120 may not be applied;
  // undefined behaves exactly like an empty list.
  extra_capabilities?: readonly string[] | null;
  // Everything this person's FIRM ROLES grant (1260), already unioned by
  // getCurrentUser. Not a users column — hence the different naming shape from
  // the two above, which deliberately mirror theirs.
  //
  // ROLES ONLY EVER ADD. There is no way to express "this role takes X away",
  // and that is a decision rather than an omission: a system that can both
  // grant and revoke gives a firm two answers to "why can she do that", which
  // is the exact mess deleting the presets escaped. The staff floor is the
  // floor; roles and grants stack on top of it.
  role_capabilities?: readonly string[] | null;
  // users.is_external — an OUTSIDE COLLABORATOR (1300). Narrows the floor to
  // nothing; roles and grants still stack on top exactly as they do for staff.
  //
  // Absent until 1300 is applied, which reads as false, so deploying this code
  // before the migration leaves every existing person on the staff floor.
  // Fail OPEN here on purpose: the flag's job is to narrow, and a missing
  // column must not restrict somebody nobody marked.
  is_external?: boolean | null;
};

// Everything this person can do: the floor, plus their roles, plus their own
// grants.
//
// An OWNER gets everything, decided by users.role and nothing else. The rank is
// what RLS enforces, so any other input claiming to demote an owner would lock
// them out of their own firm with no way back.
export function capabilitiesFor(
  subject: CapabilitySubject,
): ReadonlySet<Capability> {
  // An OWNER is an owner even if some other column disagrees — the rank is
  // what RLS enforces, and an owner locked out of their own firm has no way
  // back. The external flag is deliberately not consulted here.
  if (subject.role === "owner") return OWNER_SET;
  const base = subject.is_external === true ? EXTERNAL_SET : STAFF_SET;
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
