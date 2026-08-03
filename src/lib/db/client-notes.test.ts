import { describe, it, expect } from "vitest";
import { isMissingClientNotesSchema } from "./client-notes";
import { CLIENT_NOTE_MAX } from "@/lib/clients/note";

describe("isMissingClientNotesSchema", () => {
  it("recognises a missing table and a missing column", () => {
    // PostgREST and Postgres each have their own pair. All four mean the same
    // thing to us: 1270 has not been applied to this database yet.
    for (const code of ["PGRST205", "42P01", "PGRST204", "42703"]) {
      expect(isMissingClientNotesSchema({ code })).toBe(true);
    }
  });

  it("does not swallow a real failure", () => {
    // The whole point of matching narrow codes is that a permission denial or
    // a constraint violation still surfaces instead of being reported to the
    // user as "notes aren't switched on yet".
    for (const code of ["42501", "23514", "23503", "PGRST301", "", null, undefined]) {
      expect(isMissingClientNotesSchema({ code })).toBe(false);
    }
    expect(isMissingClientNotesSchema(null)).toBe(false);
    expect(isMissingClientNotesSchema(undefined)).toBe(false);
  });

  it("matches on the CODE, never the message (repo rule)", () => {
    // Message text is not an API — it changes between PostgREST versions and
    // is localised by some drivers.
    expect(
      isMissingClientNotesSchema({
        code: "42501",
        message: "relation \"client_notes\" does not exist",
      } as { code: string }),
    ).toBe(false);
  });
});

describe("CLIENT_NOTE_MAX", () => {
  it("matches the CHECK constraint in migration 1270", () => {
    // 1270 says `char_length(body) between 1 and 4000`. If this drifts, the
    // composer lets someone type a note the database will refuse — an error
    // that arrives only after they hit send.
    expect(CLIENT_NOTE_MAX).toBe(4000);
  });
});
