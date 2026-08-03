// The AI Organize review queue previews documents in an
// <iframe src="/api/files/…">. The site-wide X-Frame-Options: DENY forbids
// even same-origin framing — every preview rendered as a gray broken-page
// box until /api/files got its scoped SAMEORIGIN override. These tests pin
// that override: that it exists, that it stays scoped, and that it comes
// AFTER the catch-all (Next applies header rules in order, last write per
// key, so an earlier position would silently lose to DENY again).

import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

async function rules() {
  const headers = await nextConfig.headers!();
  return headers as Array<{
    source: string;
    headers: { key: string; value: string }[];
  }>;
}

describe("file preview frame headers", () => {
  it("keeps the site-wide default at DENY", async () => {
    const all = await rules();
    const catchAll = all.find((r) => r.source === "/:path*")!;
    expect(catchAll.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });
  });

  it("lets ONLY our own origin frame the file bytes route", async () => {
    const all = await rules();
    const files = all.find((r) => r.source === "/api/files/:path*");
    expect(files).toBeDefined();
    expect(files!.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
    });
    expect(files!.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: "frame-ancestors 'self'",
    });
  });

  it("places the override AFTER the catch-all so it actually wins", async () => {
    const all = await rules();
    const catchAllIdx = all.findIndex((r) => r.source === "/:path*");
    const filesIdx = all.findIndex((r) => r.source === "/api/files/:path*");
    expect(catchAllIdx).toBeGreaterThanOrEqual(0);
    expect(filesIdx).toBeGreaterThan(catchAllIdx);
  });

  it("does not loosen the portal file routes", async () => {
    // The portal serves client documents on token URLs — those must stay
    // unframeable. Only the firm-side /api/files route gets the exception.
    const all = await rules();
    for (const r of all) {
      if (r.source.startsWith("/api/portal")) {
        for (const h of r.headers) {
          expect(h).not.toEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" });
        }
      }
    }
  });
});
