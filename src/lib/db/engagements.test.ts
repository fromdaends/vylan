import { describe, it, expect } from "vitest";
import { newMagicToken } from "./engagements";

describe("newMagicToken", () => {
  it("returns a 43-char URL-safe token", () => {
    const t = newMagicToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("returns a different token on each call", () => {
    const a = newMagicToken();
    const b = newMagicToken();
    expect(a).not.toBe(b);
  });

  it("has enough entropy to be unguessable (no collisions in 1000 samples)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(newMagicToken());
    expect(set.size).toBe(1000);
  });
});
