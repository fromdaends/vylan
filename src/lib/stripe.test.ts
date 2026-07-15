import { describe, it, expect, afterEach } from "vitest";
import { stripeKeyMode } from "./stripe";

const ORIG = process.env.STRIPE_SECRET_KEY;
afterEach(() => {
  if (ORIG === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIG;
});

describe("stripeKeyMode", () => {
  it("detects live-mode secret and restricted keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    expect(stripeKeyMode()).toBe("live");
    process.env.STRIPE_SECRET_KEY = "rk_live_abc123";
    expect(stripeKeyMode()).toBe("live");
  });

  it("detects test-mode secret and restricted keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    expect(stripeKeyMode()).toBe("test");
    process.env.STRIPE_SECRET_KEY = "rk_test_abc123";
    expect(stripeKeyMode()).toBe("test");
  });

  it("returns null for a missing, empty, or non-secret key", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeKeyMode()).toBeNull();
    process.env.STRIPE_SECRET_KEY = "   ";
    expect(stripeKeyMode()).toBeNull();
    // publishable key is not a secret key shape
    process.env.STRIPE_SECRET_KEY = "pk_live_abc123";
    expect(stripeKeyMode()).toBeNull();
  });
});
