// Kill-switch for the in-app billing UI while we're acquiring our first
// few clients via direct conversation (custom pricing per client, no
// fixed plan price feels right yet). When this flips back to true:
//   - /billing renders the real plan picker + Stripe checkout again
//   - the link card on /settings reappears
//   - the trial-expired wall in plan-limits.ts re-engages so demos
//     have to convert to a paid plan after 14 days
//
// The Stripe webhook + checkout API routes are kept wired so the
// existing customers (if any land via a direct Stripe link) don't
// break — only the in-app entry points are gated.
export const BILLING_ENABLED = false;
