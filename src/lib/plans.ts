// Plan catalog. The source of truth for what each plan is named, what it
// costs, and what limits it enforces. Stripe price IDs come from env vars
// because the actual price objects live in your Stripe dashboard.

// `cabinet_plus` is retained as a legacy tier so existing DB rows still
// resolve in PLANS[firm.plan]. New signups can only pick "solo" or
// "cabinet" — see PAID_PLANS.
export type PlanId = "trial" | "solo" | "cabinet" | "cabinet_plus";

export type Plan = {
  id: PlanId;
  monthlyCadCents: number | null;
  maxActiveEngagements: number | null;
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
    monthlyCadCents: 7900,
    maxActiveEngagements: 50,
    maxUsers: 1,
    stripePriceEnv: "STRIPE_PRICE_SOLO",
  },
  cabinet: {
    id: "cabinet",
    monthlyCadCents: 15900,
    maxActiveEngagements: null,
    maxUsers: 10,
    stripePriceEnv: "STRIPE_PRICE_CABINET",
  },
  cabinet_plus: {
    id: "cabinet_plus",
    monthlyCadCents: 14900,
    maxActiveEngagements: null,
    maxUsers: 15,
    stripePriceEnv: null,
  },
};

export const PAID_PLANS: PlanId[] = ["solo", "cabinet"];

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
