import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { socialMetadata, X_HANDLE } from "./metadata";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://vylan.app");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("socialMetadata", () => {
  it("falls back to the default locale rather than emitting a broken url", () => {
    const meta = socialMetadata({ locale: "de", title: "Vylan" });
    expect(meta.openGraph).toMatchObject({
      url: "https://vylan.app",
      locale: "en_CA",
    });
  });

  it("asks for the large image card — the tag that makes X show a picture", () => {
    const meta = socialMetadata({ locale: "en", title: "Vylan" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("credits the Vylan X account", () => {
    const meta = socialMetadata({ locale: "en", title: "Vylan" });
    expect(meta.twitter).toMatchObject({ site: X_HANDLE, creator: X_HANDLE });
    expect(X_HANDLE).toBe("@vylanapp");
  });

  it("builds an absolute English url with no locale prefix (localePrefix: as-needed)", () => {
    const meta = socialMetadata({ locale: "en", title: "Vylan" });
    expect(meta.openGraph).toMatchObject({ url: "https://vylan.app" });
  });

  it("prefixes French urls with /fr", () => {
    const meta = socialMetadata({
      locale: "fr",
      title: "Vylan",
      path: "/how-it-works",
    });
    expect(meta.openGraph).toMatchObject({
      url: "https://vylan.app/fr/how-it-works",
      locale: "fr_CA",
      alternateLocale: "en_CA",
    });
  });

  it("carries the page title and description onto both cards", () => {
    const meta = socialMetadata({
      locale: "en",
      title: "Page title",
      description: "Page description",
    });
    expect(meta.openGraph).toMatchObject({
      title: "Page title",
      description: "Page description",
    });
    expect(meta.twitter).toMatchObject({
      title: "Page title",
      description: "Page description",
    });
  });

  it("omits description entirely rather than emitting an empty tag", () => {
    const meta = socialMetadata({ locale: "en", title: "Vylan" });
    expect(meta.openGraph).not.toHaveProperty("description");
    expect(meta.twitter).not.toHaveProperty("description");
  });

  // The card image comes from opengraph-image.tsx / twitter-image.tsx, and Next
  // gives file-based metadata priority over config. Setting images here would be
  // dead code that silently diverges from what actually ships.
  it("leaves images to the file-based routes", () => {
    const meta = socialMetadata({ locale: "en", title: "Vylan" });
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).not.toHaveProperty("images");
  });

  it("marks the site as a website with the Vylan site name", () => {
    const meta = socialMetadata({ locale: "en", title: "Vylan" });
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: "Vylan",
    });
  });
});
