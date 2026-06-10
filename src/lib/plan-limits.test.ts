import { describe, it, expect } from "vitest";
import { PLANS, priceIdFor, PAID_PLANS } from "./plans";

describe("plan catalog", () => {
  it("locks in the spec prices in CAD cents", () => {
    expect(PLANS.solo.monthlyCadCents).toBe(7900);
    expect(PLANS.cabinet.monthlyCadCents).toBe(15900);
  });

  it("locks in active-engagement caps per the spec", () => {
    expect(PLANS.solo.maxActiveEngagements).toBe(50);
    expect(PLANS.cabinet.maxActiveEngagements).toBeNull();
  });

  it("locks in seat caps per the spec", () => {
    // Locked tiers (2026-06 autorun): Solo 2 / Cabinet 6 / Cabinet+ 15.
    expect(PLANS.solo.maxUsers).toBe(2);
    expect(PLANS.cabinet.maxUsers).toBe(6);
    expect(PLANS.cabinet_plus.maxUsers).toBe(15);
  });

  it("trial gets a soft cap + 5 seats", () => {
    expect(PLANS.trial.maxActiveEngagements).toBe(25);
    expect(PLANS.trial.maxUsers).toBe(5);
    expect(PLANS.trial.monthlyCadCents).toBeNull();
  });

  it("exposes only the two current paid plans for checkout", () => {
    expect(PAID_PLANS).toEqual(["solo", "cabinet"]);
    expect(PAID_PLANS).not.toContain("trial");
    expect(PAID_PLANS).not.toContain("cabinet_plus");
  });

  it("priceIdFor returns null when env not configured", () => {
    // (test env doesn't have STRIPE_PRICE_* set)
    delete process.env.STRIPE_PRICE_SOLO;
    expect(priceIdFor("solo")).toBeNull();
  });

  it("priceIdFor reads from env when configured", () => {
    process.env.STRIPE_PRICE_SOLO = "price_test_123";
    expect(priceIdFor("solo")).toBe("price_test_123");
    delete process.env.STRIPE_PRICE_SOLO;
  });

  it("trial has no Stripe price (can't be picked at checkout)", () => {
    expect(priceIdFor("trial")).toBeNull();
  });
});
