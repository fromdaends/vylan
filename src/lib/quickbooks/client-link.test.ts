import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  matchClientByCompanyName,
} from "./client-link";

const clients = [
  { id: "c1", name: "Acme Consulting" },
  { id: "c2", name: "Northwind Traders" },
  { id: "c3", name: "Beacon Legal" },
];

describe("normalizeCompanyName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeCompanyName("  Acme   Consulting  ")).toBe("acme consulting");
    expect(normalizeCompanyName("NORTHWIND\tTraders")).toBe("northwind traders");
  });
});

describe("matchClientByCompanyName", () => {
  it("links on an exact (normalized) name match", () => {
    expect(matchClientByCompanyName("Acme Consulting", clients)?.id).toBe("c1");
    expect(matchClientByCompanyName("  acme   consulting ", clients)?.id).toBe(
      "c1",
    );
  });

  it("returns null when nothing matches (owner picks manually)", () => {
    expect(matchClientByCompanyName("Globex", clients)).toBeNull();
  });

  it("returns null on an empty/blank company name", () => {
    expect(matchClientByCompanyName("", clients)).toBeNull();
    expect(matchClientByCompanyName(null, clients)).toBeNull();
    expect(matchClientByCompanyName("   ", clients)).toBeNull();
  });

  it("returns null when MORE THAN ONE client matches (ambiguous, never guess)", () => {
    const dupes = [
      { id: "a", name: "Acme Consulting" },
      { id: "b", name: "acme consulting" },
    ];
    expect(matchClientByCompanyName("Acme Consulting", dupes)).toBeNull();
  });
});
