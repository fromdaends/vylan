import { describe, it, expect } from "vitest";
import { lastEditedLine } from "./last-edited";

// A stand-in translator: returns the key plus its values, so the tests assert
// WHICH message was chosen and what was interpolated, not the English wording.
const t = (key: string, values?: Record<string, string>) =>
  values ? `${key}|${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")}` : key;

const base = {
  updatedAt: "2026-08-05T14:30:00.000Z",
  updatedByUserId: null as string | null,
  viewerUserId: "me",
  nameById: new Map<string, string>([["her", "Sarah Chen"]]),
};

describe("lastEditedLine", () => {
  it("says 'by me' for the viewer's own edit", () => {
    const out = lastEditedLine({ ...base, updatedByUserId: "me" }, t, "en");
    expect(out).toContain("last_edited_by_me");
  });

  it("names a teammate", () => {
    const out = lastEditedLine({ ...base, updatedByUserId: "her" }, t, "en");
    expect(out).toContain("last_edited_by");
    expect(out).toContain("name=Sarah Chen");
  });

  it("falls back to the plain date when nobody was recorded", () => {
    const out = lastEditedLine(base, t, "en");
    expect(out).toMatch(/^last_edited\|/);
    expect(out).not.toContain("name=");
  });

  it("falls back to the plain date for an id it cannot name", () => {
    // A deactivated teammate: better a bare date than a raw uuid at somebody.
    const out = lastEditedLine({ ...base, updatedByUserId: "ghost" }, t, "en");
    expect(out).toMatch(/^last_edited\|/);
  });

  it("returns null when there is no timestamp", () => {
    expect(lastEditedLine({ ...base, updatedAt: null }, t, "en")).toBeNull();
  });

  it("returns null for an unparseable timestamp rather than 'Invalid Date'", () => {
    expect(lastEditedLine({ ...base, updatedAt: "not a date" }, t, "en")).toBeNull();
  });

  it("formats the date for the locale", () => {
    const en = lastEditedLine({ ...base, updatedByUserId: "me" }, t, "en");
    const fr = lastEditedLine({ ...base, updatedByUserId: "me" }, t, "fr");
    // Both name a 2026 date; the point is the formatter is locale-driven and
    // neither throws.
    expect(en).toContain("2026");
    expect(fr).toContain("2026");
  });

  it("does not treat an empty viewer as a match for an unrecorded editor", () => {
    // null === null must NOT read as "by me".
    const out = lastEditedLine(
      { ...base, updatedByUserId: null, viewerUserId: null },
      t,
      "en",
    );
    expect(out).not.toContain("by_me");
  });
});
