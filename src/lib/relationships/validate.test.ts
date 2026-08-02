import { describe, expect, it } from "vitest";
import {
  canonicalSpousePair,
  engagementDomainForType,
  findScopeWarning,
  resolveRelationshipRows,
  scopesCoverDomain,
  validateRelationship,
  type RelationshipRecord,
} from "./validate";

const IND_A = { id: "aaaaaaaa-0000-0000-0000-000000000001", type: "individual" as const };
const IND_B = { id: "bbbbbbbb-0000-0000-0000-000000000002", type: "individual" as const };
const BIZ = { id: "cccccccc-0000-0000-0000-000000000003", type: "business" as const };

describe("validateRelationship", () => {
  it("rejects unknown types and self-links", () => {
    expect(
      validateRelationship({ relType: "cousin_of", from: IND_A, to: IND_B }),
    ).toEqual({ ok: false, error: "bad_type" });
    expect(
      validateRelationship({ relType: "spouse_of", from: IND_A, to: IND_A }),
    ).toEqual({ ok: false, error: "self_link" });
  });

  it("owner_of requires individual → business and an integer percentage 1–100", () => {
    expect(
      validateRelationship({ relType: "owner_of", from: BIZ, to: IND_A, percentage: 50 }),
    ).toEqual({ ok: false, error: "owner_shape" });
    for (const bad of [0, 101, 49.5, undefined, null, NaN]) {
      expect(
        validateRelationship({ relType: "owner_of", from: IND_A, to: BIZ, percentage: bad as number | null | undefined }),
      ).toEqual({ ok: false, error: "percentage_invalid" });
    }
    const ok = validateRelationship({
      relType: "owner_of",
      from: IND_A,
      to: BIZ,
      percentage: 100,
    });
    expect(ok).toMatchObject({
      ok: true,
      relType: "owner_of",
      fromClientId: IND_A.id,
      toClientId: BIZ.id,
      percentage: 100,
      scopes: null,
    });
  });

  it("spouse_of requires two individuals and canonicalizes the pair order", () => {
    expect(
      validateRelationship({ relType: "spouse_of", from: IND_A, to: BIZ }),
    ).toEqual({ ok: false, error: "spouse_shape" });
    // Passed in "backwards" (B first) — stored order is still A, B.
    const ok = validateRelationship({ relType: "spouse_of", from: IND_B, to: IND_A });
    expect(ok).toMatchObject({
      ok: true,
      fromClientId: IND_A.id,
      toClientId: IND_B.id,
      percentage: null,
      scopes: null,
    });
  });

  it("authorized_contact requires individual → business and known scopes", () => {
    expect(
      validateRelationship({ relType: "authorized_contact", from: IND_A, to: BIZ, scopes: [] }),
    ).toEqual({ ok: false, error: "scopes_invalid" });
    expect(
      validateRelationship({
        relType: "authorized_contact",
        from: IND_A,
        to: BIZ,
        scopes: ["payroll", "everything"],
      }),
    ).toEqual({ ok: false, error: "scopes_invalid" });
    const ok = validateRelationship({
      relType: "authorized_contact",
      from: IND_A,
      to: BIZ,
      scopes: ["gst_qst", "payroll", "payroll"],
    });
    // Deduped, vocabulary order.
    expect(ok).toMatchObject({ ok: true, scopes: ["payroll", "gst_qst"] });
  });

  it("'all' subsumes every other selected scope", () => {
    const ok = validateRelationship({
      relType: "authorized_contact",
      from: IND_A,
      to: BIZ,
      scopes: ["payroll", "all"],
    });
    expect(ok).toMatchObject({ ok: true, scopes: ["all"] });
  });
});

describe("canonicalSpousePair", () => {
  it("orders the pair the way Postgres orders uuids (lowercase string order)", () => {
    expect(canonicalSpousePair(IND_B.id, IND_A.id)).toEqual([IND_A.id, IND_B.id]);
    expect(canonicalSpousePair(IND_A.id.toUpperCase(), IND_B.id)).toEqual([
      IND_A.id,
      IND_B.id,
    ]);
  });
});

describe("resolveRelationshipRows", () => {
  const rels: RelationshipRecord[] = [
    {
      id: "r1",
      from_client_id: IND_A.id,
      to_client_id: BIZ.id,
      rel_type: "owner_of",
      percentage: 100,
      scopes: null,
    },
    {
      id: "r2",
      from_client_id: IND_A.id,
      to_client_id: IND_B.id,
      rel_type: "spouse_of",
      percentage: null,
      scopes: null,
    },
    {
      id: "r3",
      from_client_id: IND_B.id,
      to_client_id: BIZ.id,
      rel_type: "authorized_contact",
      percentage: null,
      scopes: ["payroll"],
    },
  ];

  it("resolves direction from the profile client's side and sorts spouse → owner → contact", () => {
    const rows = resolveRelationshipRows(IND_A.id, rels);
    expect(rows.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(rows[0]).toMatchObject({ direction: "out", otherClientId: IND_B.id });
    expect(rows[1]).toMatchObject({ direction: "out", otherClientId: BIZ.id });
  });

  it("shows the mirrored side on the business profile", () => {
    const rows = resolveRelationshipRows(BIZ.id, rels);
    expect(rows.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(rows[0]).toMatchObject({ direction: "in", otherClientId: IND_A.id });
    expect(rows[1]).toMatchObject({
      direction: "in",
      otherClientId: IND_B.id,
      scopes: ["payroll"],
    });
  });

  it("spouse rows resolve from the canonical-second side too", () => {
    const rows = resolveRelationshipRows(IND_B.id, rels);
    expect(rows[0]).toMatchObject({
      id: "r2",
      direction: "in",
      otherClientId: IND_A.id,
    });
  });
});

describe("scope warning", () => {
  it("maps engagement types to scope domains (t1/custom have none)", () => {
    expect(engagementDomainForType("t2")).toBe("corporate_tax");
    expect(engagementDomainForType("bookkeeping")).toBe("bookkeeping");
    expect(engagementDomainForType("t1")).toBeNull();
    expect(engagementDomainForType("custom")).toBeNull();
  });

  it("'all' covers every domain", () => {
    expect(scopesCoverDomain(["all"], "corporate_tax")).toBe(true);
    expect(scopesCoverDomain(["payroll"], "corporate_tax")).toBe(false);
    expect(scopesCoverDomain(["payroll", "corporate_tax"], "corporate_tax")).toBe(true);
  });

  const marie = {
    clientId: IND_A.id,
    name: "Marie Thresh",
    email: "Marie@Example.com",
    scopes: ["payroll"] as ("payroll")[],
  };

  it("warns when the business email belongs to a contact whose scopes miss the domain", () => {
    expect(
      findScopeWarning("marie@example.com", "t2", [marie]),
    ).toMatchObject({ name: "Marie Thresh" });
  });

  it("stays quiet when scopes cover the domain, emails differ, or the type has no domain", () => {
    expect(
      findScopeWarning("marie@example.com", "t2", [
        { ...marie, scopes: ["all"] },
      ]),
    ).toBeNull();
    expect(findScopeWarning("info@threshjett.com", "t2", [marie])).toBeNull();
    expect(findScopeWarning("marie@example.com", "t1", [marie])).toBeNull();
    expect(findScopeWarning(null, "t2", [marie])).toBeNull();
  });
});
