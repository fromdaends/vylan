import { describe, it, expect } from "vitest";
import { customerCandidatesFromQuery } from "./import-clients";
import { sanitizeCandidates } from "@/lib/db/client-import";
import { xeroContactCandidatesFromResponse } from "@/lib/xero/client";

describe("customerCandidatesFromQuery (QuickBooks)", () => {
  it("maps DisplayName + nested email/phone, skipping nameless rows", () => {
    const rows = [
      {
        DisplayName: "Boulangerie Lévis Inc.",
        PrimaryEmailAddr: { Address: "compta@boulangerie.example" },
        PrimaryPhone: { FreeFormNumber: "418-555-1111" },
      },
      { DisplayName: "  Marie Tremblay  " }, // no email/phone
      { PrimaryEmailAddr: { Address: "orphan@example.com" } }, // no name → dropped
      { DisplayName: "" },
    ];
    expect(customerCandidatesFromQuery(rows)).toEqual([
      {
        display_name: "Boulangerie Lévis Inc.",
        email: "compta@boulangerie.example",
        phone: "418-555-1111",
      },
      { display_name: "Marie Tremblay", email: null, phone: null },
    ]);
  });

  it("returns [] for a non-array payload", () => {
    expect(customerCandidatesFromQuery(null)).toEqual([]);
    expect(customerCandidatesFromQuery({})).toEqual([]);
  });
});

describe("xeroContactCandidatesFromResponse", () => {
  it("keeps customers + un-flagged contacts, drops pure suppliers + archived", () => {
    const contacts = [
      {
        Name: "Northern Lights Co.",
        ContactStatus: "ACTIVE",
        IsCustomer: true,
        EmailAddress: "billing@northern.example",
        Phones: [
          { PhoneType: "DEFAULT", PhoneNumber: "5551122", PhoneAreaCode: "416" },
        ],
      },
      // Un-flagged (never used on a transaction) → kept: could be a client.
      { Name: "Fresh Contact", ContactStatus: "ACTIVE" },
      // Vendor-only → not one of the firm's clients.
      { Name: "Hydro Supplier", ContactStatus: "ACTIVE", IsSupplier: true },
      // Archived → dropped.
      { Name: "Old Client", ContactStatus: "ARCHIVED", IsCustomer: true },
    ];
    expect(xeroContactCandidatesFromResponse(contacts)).toEqual([
      {
        display_name: "Northern Lights Co.",
        email: "billing@northern.example",
        phone: "4165551122",
      },
      { display_name: "Fresh Contact", email: null, phone: null },
    ]);
  });

  it("keeps a contact that is BOTH supplier and customer", () => {
    const out = xeroContactCandidatesFromResponse([
      { Name: "Both Ways Ltd", ContactStatus: "ACTIVE", IsSupplier: true, IsCustomer: true },
    ]);
    expect(out.map((c) => c.display_name)).toEqual(["Both Ways Ltd"]);
  });
});

describe("sanitizeCandidates", () => {
  it("drops malformed rows, trims, and caps at 1000", () => {
    const raw = [
      { display_name: " Acme ", email: " a@b.co ", phone: "" },
      { display_name: "", email: "x@y.z" },
      { display_name: "x".repeat(161) },
      "not-an-object",
    ];
    expect(sanitizeCandidates(raw)).toEqual([
      { display_name: "Acme", email: "a@b.co", phone: null },
    ]);
    const big = Array.from({ length: 1200 }, (_, i) => ({
      display_name: `C${i}`,
    }));
    expect(sanitizeCandidates(big)).toHaveLength(1000);
  });
});
