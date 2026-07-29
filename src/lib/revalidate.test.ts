import { describe, it, expect } from "vitest";
import { localizedPath } from "./revalidate";

// The bug this exists for: with localePrefix "as-needed", an English page is
// served at /quickbooks/drafts, but every call site revalidated
// /en/quickbooks/drafts — a path that is never rendered. Nothing errors when a
// path does not match, so the miss was invisible; the symptom was a page that
// kept showing stale data after a successful action.
describe("localizedPath", () => {
  it("drops the prefix for the DEFAULT locale, which is how it is served", () => {
    expect(localizedPath("/quickbooks/drafts", "en")).toBe("/quickbooks/drafts");
  });

  it("keeps the prefix for a non-default locale", () => {
    expect(localizedPath("/quickbooks/drafts", "fr")).toBe(
      "/fr/quickbooks/drafts",
    );
  });

  it("tolerates a path given without a leading slash", () => {
    expect(localizedPath("dashboard", "en")).toBe("/dashboard");
    expect(localizedPath("dashboard", "fr")).toBe("/fr/dashboard");
  });

  it("handles nested paths with ids", () => {
    expect(localizedPath("/engagements/abc-123", "en")).toBe(
      "/engagements/abc-123",
    );
    expect(localizedPath("/engagements/abc-123", "fr")).toBe(
      "/fr/engagements/abc-123",
    );
  });
});
