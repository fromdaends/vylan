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
});
