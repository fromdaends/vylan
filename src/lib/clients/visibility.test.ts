import { describe, it, expect } from "vitest";
import { clientVisibility, CLIENT_VISIBILITIES } from "./visibility";

// The middle privacy level's reader (migration 1280).
//
// It is three lines, and it is worth a test file because it FAILS CLOSED and
// the failure is silent in the dangerous direction. If an unapplied migration,
// a typo or a transient read made this resolve to "listed", a client that is
// meant to be members-only becomes a firm-wide directory entry and nothing
// errors — the page simply renders for somebody who should not have it.
//
// Note this is the OPPOSITE default from is_private, which fails OPEN on
// purpose (a read blip must not hide a client from the person working on it).
// The two live one field apart and want opposite defaults, which is exactly
// why each says so out loud.

describe("clientVisibility", () => {
  it("resolves the only widening value, and only when exact", () => {
    expect(clientVisibility({ visibility: "listed" })).toBe("listed");
    expect(clientVisibility({ visibility: "members" })).toBe("members");
  });

  it("FAILS CLOSED on anything it does not recognise", () => {
    for (const v of [
      undefined,
      null,
      "",
      " listed",
      "listed ",
      "Listed",
      "LISTED",
      "public",
      "open",
      "everyone",
      "0",
    ]) {
      expect(clientVisibility({ visibility: v as string })).toBe("members");
    }
  });

  it("treats a missing column as members-only", () => {
    // What every read looks like until 1280 is applied. Deploying the code
    // before the migration must not widen anybody's access.
    expect(clientVisibility({})).toBe("members");
    expect(clientVisibility(null)).toBe("members");
    expect(clientVisibility(undefined)).toBe("members");
  });

  it("lists exactly the two states the check constraint allows", () => {
    // If a third is ever added here without the migration's CHECK being
    // widened, writes of it are refused by the database at runtime.
    expect([...CLIENT_VISIBILITIES]).toEqual(["members", "listed"]);
  });
});
