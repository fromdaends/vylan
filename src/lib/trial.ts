// Free-trial helpers. New firms from the public signup flow start a 14-day
// free trial with FULL access to the real product (no fake demo data, no
// blocked actions). `is_demo` is reused as the "unconverted trial account"
// flag — true while a firm is on the free trial, flipped to false when they
// convert to a paid plan (Stripe webhook, or a manual conversion after a
// pricing call). `trial_ends_at` is the clock; once it passes (and there's no
// active subscription) the app gates write actions behind a "book a meeting"
// prompt — see plan-limits.ts + the trial banner / block UI.
//
// All functions are pure (the caller passes `nowMs`) so they're trivially
// testable and free of Date.now() side effects.

import type { Firm } from "@/lib/db/firms";

export const TRIAL_DAYS = 14;
const DAY_MS = 86_400_000;

// ISO timestamp `TRIAL_DAYS` after `startMs` (firm creation). Used by
// onboarding when the firm is first created.
export function trialEndsAtFrom(startMs: number): string {
  return new Date(startMs + TRIAL_DAYS * DAY_MS).toISOString();
}

type TrialFirm = Pick<Firm, "is_demo" | "trial_ends_at" | "subscription_status">;

// Is this an unconverted free-trial firm (vs. a paid/live one)?
export function isOnTrial(firm: Pick<Firm, "is_demo">): boolean {
  return firm.is_demo === true;
}

// Has the free trial run out without converting? True only for trial firms
// whose clock has passed and who aren't covered by an active/trialing Stripe
// subscription (so a firm mid-payment is never wrongly locked out).
export function isTrialExpired(
  firm: TrialFirm,
  nowMs: number = Date.now(),
): boolean {
  if (!firm.is_demo) return false;
  if (!firm.trial_ends_at) return false;
  const endMs = new Date(firm.trial_ends_at).getTime();
  if (Number.isNaN(endMs) || endMs > nowMs) return false;
  const sub = firm.subscription_status;
  if (sub === "active" || sub === "trialing") return false;
  return true;
}

// Whole days left in the trial (>= 0), or null if no clock is set. The day the
// trial lapses returns 0.
export function trialDaysLeft(
  firm: Pick<Firm, "trial_ends_at">,
  nowMs: number = Date.now(),
): number | null {
  if (!firm.trial_ends_at) return null;
  const endMs = new Date(firm.trial_ends_at).getTime();
  if (Number.isNaN(endMs)) return null;
  const remaining = endMs - nowMs;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}
