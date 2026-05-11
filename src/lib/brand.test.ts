import { describe, it, expect } from "vitest";
import { brand } from "./brand";

describe("brand", () => {
  it("exposes a name", () => {
    expect(brand.name).toMatch(/.+/);
  });
  it("has both FR and EN taglines", () => {
    expect(brand.tagline.fr).toMatch(/.+/);
    expect(brand.tagline.en).toMatch(/.+/);
  });
  it("ships valid hex colors", () => {
    for (const c of Object.values(brand.colors)) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
