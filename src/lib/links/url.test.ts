import { describe, it, expect } from "vitest";
import { normalizeLinkUrl } from "./url";

describe("normalizeLinkUrl", () => {
  it("keeps a proper https URL", () => {
    expect(normalizeLinkUrl("https://dashboard.stripe.com")).toBe(
      "https://dashboard.stripe.com/",
    );
  });

  it("helps a bare domain to https", () => {
    expect(normalizeLinkUrl("stripe.com")).toBe("https://stripe.com/");
    expect(normalizeLinkUrl("  cra.gc.ca/business  ")).toBe(
      "https://cra.gc.ca/business",
    );
  });

  it("allows plain http", () => {
    expect(normalizeLinkUrl("http://intranet.local/wiki")).toBe(
      "http://intranet.local/wiki",
    );
  });

  it("rejects every scheme that could run script or read files", () => {
    // These are rendered as <a href> for the whole firm — a stored
    // javascript: URL would execute in every member's session.
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(normalizeLinkUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeLinkUrl("vbscript:x")).toBeNull();
  });

  it("rejects empties, whitespace and the unparseable", () => {
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("   ")).toBeNull();
    expect(normalizeLinkUrl("https://")).toBeNull();
    expect(normalizeLinkUrl("ht tp://x")).toBeNull();
  });

  it("rejects the absurdly long", () => {
    expect(normalizeLinkUrl("https://x.com/" + "a".repeat(2048))).toBeNull();
  });
});
