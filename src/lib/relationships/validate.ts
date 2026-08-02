// Client relationships — the pure rules, shared by the server actions (the
// enforcement) and the dialog (the UX). The database re-enforces all of this
// independently (1150's CHECKs + guard trigger); this layer exists to turn
// violations into typed, translatable errors instead of SQL exceptions.

export const RELATIONSHIP_TYPES = [
  "owner_of",
  "spouse_of",
  "authorized_contact",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_SCOPES = [
  "all",
  "payroll",
  "corporate_tax",
  "bookkeeping",
  "gst_qst",
] as const;
export type RelationshipScope = (typeof RELATIONSHIP_SCOPES)[number];

export type ClientEnd = {
  id: string;
  type: "individual" | "business";
};

export type RelationshipValidationError =
  | "self_link"
  | "bad_type"
  | "owner_shape" // owner_of must be individual → business
  | "spouse_shape" // spouse_of must be individual ↔ individual
  | "contact_shape" // authorized_contact must be individual → business
  | "percentage_invalid" // owner_of needs an integer 1–100
  | "scopes_invalid"; // authorized_contact needs ≥1 known scope

export type ValidatedRelationship = {
  ok: true;
  relType: RelationshipType;
  fromClientId: string;
  toClientId: string;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
};

export type RelationshipValidationFailure = {
  ok: false;
  error: RelationshipValidationError;
};

function isScope(value: string): value is RelationshipScope {
  return (RELATIONSHIP_SCOPES as readonly string[]).includes(value);
}

// Spouse rows are stored ONCE per couple, lower uuid first — the same order
// Postgres' uuid comparison yields, so the DB CHECK (from < to) and this
// function always agree. Lowercased defensively; Supabase returns lowercase.
export function canonicalSpousePair(
  a: string,
  b: string,
): [string, string] {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? [la, lb] : [lb, la];
}

// Validate a proposed relationship between two loaded clients. `from`/`to`
// follow the storage convention: for owner_of and authorized_contact, from is
// the individual and to is the business; for spouse_of the order is
// canonicalized here.
export function validateRelationship(input: {
  relType: string;
  from: ClientEnd;
  to: ClientEnd;
  percentage?: number | null;
  scopes?: string[] | null;
}): ValidatedRelationship | RelationshipValidationFailure {
  const { from, to } = input;
  if (!(RELATIONSHIP_TYPES as readonly string[]).includes(input.relType)) {
    return { ok: false, error: "bad_type" };
  }
  const relType = input.relType as RelationshipType;
  if (from.id === to.id) return { ok: false, error: "self_link" };

  if (relType === "owner_of") {
    if (from.type !== "individual" || to.type !== "business") {
      return { ok: false, error: "owner_shape" };
    }
    const pct = input.percentage;
    if (
      typeof pct !== "number" ||
      !Number.isInteger(pct) ||
      pct < 1 ||
      pct > 100
    ) {
      return { ok: false, error: "percentage_invalid" };
    }
    return {
      ok: true,
      relType,
      fromClientId: from.id,
      toClientId: to.id,
      percentage: pct,
      scopes: null,
    };
  }

  if (relType === "spouse_of") {
    if (from.type !== "individual" || to.type !== "individual") {
      return { ok: false, error: "spouse_shape" };
    }
    const [lo, hi] = canonicalSpousePair(from.id, to.id);
    return {
      ok: true,
      relType,
      fromClientId: lo,
      toClientId: hi,
      percentage: null,
      scopes: null,
    };
  }

  // authorized_contact
  if (from.type !== "individual" || to.type !== "business") {
    return { ok: false, error: "contact_shape" };
  }
  const raw = input.scopes ?? [];
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isScope)) {
    return { ok: false, error: "scopes_invalid" };
  }
  // Dedupe, keep the fixed vocabulary's order; "all" subsumes the rest.
  const scopes = raw.includes("all")
    ? (["all"] as RelationshipScope[])
    : RELATIONSHIP_SCOPES.filter((s) => s !== "all" && raw.includes(s));
  return {
    ok: true,
    relType,
    fromClientId: from.id,
    toClientId: to.id,
    percentage: null,
    scopes,
  };
}

// ── Rendering: one relationship, seen from one client's profile ──────────────

export type RelationshipRecord = {
  id: string;
  from_client_id: string;
  to_client_id: string;
  rel_type: RelationshipType;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
};

export type ResolvedRelationshipRow = {
  id: string;
  relType: RelationshipType;
  // "out": the profile client is from_client (the individual side, or the
  // canonical-first spouse). "in": the profile client is to_client.
  direction: "out" | "in";
  otherClientId: string;
  percentage: number | null;
  scopes: RelationshipScope[] | null;
};

// The profile card's rows: every live link touching `clientId`, direction
// resolved. Order matches the spec sketch — spouse, then ownership, then
// authorized contacts — with ties left in input (created_at) order.
export function resolveRelationshipRows(
  clientId: string,
  relationships: RelationshipRecord[],
): ResolvedRelationshipRow[] {
  const rows: ResolvedRelationshipRow[] = [];
  for (const r of relationships) {
    if (r.from_client_id !== clientId && r.to_client_id !== clientId) continue;
    const out = r.from_client_id === clientId;
    rows.push({
      id: r.id,
      relType: r.rel_type,
      direction: out ? "out" : "in",
      otherClientId: out ? r.to_client_id : r.from_client_id,
      percentage: r.percentage,
      scopes: r.scopes,
    });
  }
  const rank: Record<RelationshipType, number> = {
    spouse_of: 0,
    owner_of: 1,
    authorized_contact: 2,
  };
  return rows.sort((a, b) => rank[a.relType] - rank[b.relType]);
}

// ── Recipient safety (scope warning) ─────────────────────────────────────────

// The engagement types that map onto an authorized-contact scope. T1 and
// custom engagements have no scope vocabulary equivalent, so they never warn.
export function engagementDomainForType(
  engagementType: string,
): RelationshipScope | null {
  if (engagementType === "t2") return "corporate_tax";
  if (engagementType === "bookkeeping") return "bookkeeping";
  return null;
}

export function scopesCoverDomain(
  scopes: readonly string[],
  domain: RelationshipScope,
): boolean {
  return scopes.includes("all") || scopes.includes(domain);
}

export type ScopeWarningContact = {
  clientId: string;
  name: string;
  email: string | null;
  scopes: RelationshipScope[];
};

// Vylan has no recipient picker: everything sent on an engagement goes to the
// client record's one email address. So "the chosen individual" can only be
// known one way — the business's email IS some linked authorized contact's
// email. Deterministic, case-insensitive match; no guessing, no AI.
// Returns the matched contact when their scopes do NOT cover the engagement's
// domain (the caller renders the warning), else null.
export function findScopeWarning(
  businessEmail: string | null,
  engagementType: string,
  contacts: ScopeWarningContact[],
): ScopeWarningContact | null {
  const domain = engagementDomainForType(engagementType);
  if (!domain || !businessEmail) return null;
  const needle = businessEmail.trim().toLowerCase();
  if (!needle) return null;
  const match = contacts.find(
    (c) => c.email != null && c.email.trim().toLowerCase() === needle,
  );
  if (!match) return null;
  return scopesCoverDomain(match.scopes, domain) ? null : match;
}
