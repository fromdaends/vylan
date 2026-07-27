import { describe, it, expect } from "vitest";
import { siteUrl } from "./site-url";

// siteUrl() reads process.env by default but accepts an override, so every case
// here is a pure function call — no global env mutation, no ordering coupling.
const env = (overrides: Record<string, string | undefined>) =>
  overrides as unknown as NodeJS.ProcessEnv;

describe("siteUrl", () => {
  it("prefers APP_URL when set", () => {
    expect(siteUrl(env({ APP_URL: "https://vylan.app" }))).toBe(
      "https://vylan.app",
    );
  });

  it("strips a trailing slash so joined paths never double up", () => {
    expect(siteUrl(env({ APP_URL: "https://vylan.app/" }))).toBe(
      "https://vylan.app",
    );
    expect(siteUrl(env({ APP_URL: "https://vylan.app///" }))).toBe(
      "https://vylan.app",
    );
  });

  it("returns localhost for local dev, but only because APP_URL asked for it", () => {
    expect(siteUrl(env({ APP_URL: "http://localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("uses the Vercel production domain when APP_URL is missing", () => {
    expect(
      siteUrl(
        env({
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "vylan.app",
        }),
      ),
    ).toBe("https://vylan.app");
  });

  it("uses the deployment url on previews so a preview card previews the preview", () => {
    expect(
      siteUrl(
        env({
          VERCEL_ENV: "preview",
          VERCEL_PROJECT_PRODUCTION_URL: "vylan.app",
          VERCEL_URL: "vylan-git-branch.vercel.app",
        }),
      ),
    ).toBe("https://vylan-git-branch.vercel.app");
  });

  // The whole reason this module exists: a localhost og:image silently breaks
  // every link preview, because the crawler resolves it against its own machine.
  it("never invents localhost when the environment is empty", () => {
    const resolved = siteUrl(env({}));
    expect(resolved).toBe("https://vylan.app");
    expect(resolved).not.toContain("localhost");
  });

  it("ignores a blank APP_URL rather than producing a relative url", () => {
    expect(siteUrl(env({ APP_URL: "   " }))).toBe("https://vylan.app");
  });

  // The caller feeds this into `new URL()` for metadataBase on every page
  // render, so a bad value must never be handed onward — it would throw inside
  // generateMetadata and 500 the whole site, not just break the card.
  it.each([
    ["scheme forgotten", "vylan.app"],
    ["not a url at all", "replace-me"],
    ["a path", "/vylan"],
    ["a non-http scheme", "ftp://vylan.app"],
    ["javascript:", "javascript:alert(1)"],
  ])("falls through a malformed APP_URL (%s)", (_label, value) => {
    const resolved = siteUrl(env({ APP_URL: value }));
    expect(resolved).toBe("https://vylan.app");
    expect(() => new URL(resolved)).not.toThrow();
  });

  it("falls through a malformed APP_URL to Vercel rather than straight to the default", () => {
    expect(
      siteUrl(
        env({
          APP_URL: "vylan.app",
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "vylan-prod.vercel.app",
        }),
      ),
    ).toBe("https://vylan-prod.vercel.app");
  });

  it("reduces a url with a path to its bare origin", () => {
    expect(siteUrl(env({ APP_URL: "https://vylan.app/some/path" }))).toBe(
      "https://vylan.app",
    );
  });

  it("always returns something new URL() accepts", () => {
    for (const e of [{}, { APP_URL: "" }, { APP_URL: "nonsense" }]) {
      expect(() => new URL(siteUrl(env(e)))).not.toThrow();
    }
  });
});
