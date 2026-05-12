// Plan catalog. The source of truth for what each plan is named, what it
// costs, and what limits it enforces. Stripe price IDs come from env vars
// because the actual price objects live in your Stripe dashboard.

export type PlanId = "trial" | "solo" | "cabinet" | "cabinet_plus";

export type Plan = {
  id: PlanId;
  // CAD per month. The "trial" plan has no price because users can't pick
  // it directly — they're put on it at signup for 14 days.
  monthlyCadCents: number | null;
  // Max active engagements (status = sent or in_progress). null = unlimited.
  maxActiveEngagements: number | null;
  // Max users in the firm. null = unlimited.
  maxUsers: number | null;
  stripePriceEnv: string | null;
};

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial",
    monthlyCadCents: null,
    maxActiveEngagements: 25,
    maxUsers: 5,
    stripePriceEnv: null,
  },
  solo: {
    id: "solo",
    monthlyCadCents: 2900,
    maxActiveEngagements: 25,
    maxUsers: 1,
    stripePriceEnv: "STRIPE_PRICE_SOLO",
  },
  cabinet: {
    id: "cabinet",
    monthlyCadCents: 7900,
    maxActiveEngagements: 200,
    maxUsers: 5,
    stripePriceEnv: "STRIPE_PRICE_CABINET",
  },
  cabinet_plus: {
    id: "cabinet_plus",
    monthlyCadCents: 14900,
    maxActiveEngagements: null,
    maxUsers: 15,
    stripePriceEnv: "STRIPE_PRICE_CABINET_PLUS",
  },
};

export const PAID_PLANS: PlanId[] = ["solo", "cabinet", "cabinet_plus"];

export function priceIdFor(planId: PlanId): string | null {
  const env = PLANS[planId].stripePriceEnv;
  if (!env) return null;
  const id = process.env[env];
  return id && id.trim() !== "" ? id : null;
}

// Reverse lookup: derive plan from a Stripe price ID. The webhook MUST use
// this rather than trust metadata.plan, since metadata can be edited via
// the Stripe portal/API and would otherwise let users self-upgrade.
export function planForPriceId(priceId: string): PlanId | null {
  for (const plan of PAID_PLANS) {
    if (priceIdFor(plan) === priceId) return plan;
  }
  return null;
}
