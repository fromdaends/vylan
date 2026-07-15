import { NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { setFirmConnectAccountId } from "@/lib/db/stripe-connect";

export const runtime = "nodejs";

// POST /api/billing/connect/onboard
//
// Starts (or resumes) Stripe Connect STANDARD onboarding for the current firm.
// Creates a connected account on first use, persists its id (service role),
// then returns a Stripe-hosted Account Link the browser redirects to. Stripe
// collects all identity/bank/tax details — Vylan never sees them. Owner-only.
export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
  }

  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Owner-only: connecting the firm's payout account is firm-admin.
  const me = await getCurrentUser();
  if (me?.role !== "owner") {
    return NextResponse.json({ error: "owner_only" }, { status: 403 });
  }
  const firm = await getCurrentFirm();
  if (!firm) {
    return NextResponse.json({ error: "no_firm" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const s = stripe()!;

  // Reuse the firm's existing connected account if it has one (resuming an
  // incomplete onboarding); otherwise create a fresh Standard account.
  let accountId = firm.stripe_connect_account_id ?? null;
  if (!accountId) {
    try {
      const account = await s.accounts.create({
        type: "standard",
        email: auth.user.email ?? undefined,
        metadata: { firm_id: firm.id },
      });
      accountId = account.id;
    } catch (e) {
      console.error("[connect/onboard] account create failed:", e);
      return NextResponse.json(
        { error: "stripe_error", detail: stripeDetail(e) },
        { status: 502 },
      );
    }
    const saved = await setFirmConnectAccountId(firm.id, accountId);
    if (!saved.ok) {
      // Pre-migration (0370 not applied yet), a would-clobber-live refusal (a
      // test-mode env tried to overwrite a live connection), or a DB error.
      // Surface a clean status so the UI can explain rather than throwing a 500.
      // We do NOT proceed to the account link, because we couldn't store the
      // account id and would orphan it.
      const status =
        saved.reason === "migration_pending"
          ? 503
          : saved.reason === "would_clobber_live"
            ? 409
            : 500;
      return NextResponse.json({ error: saved.reason }, { status });
    }
  }

  // Hosted onboarding link. return_url / refresh_url both land back on the
  // Payments settings section; the ?connect flag lets the UI show a friendly
  // "confirming with Stripe" state while the webhook writes the real status.
  try {
    const link = await s.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: `${appUrl}/settings?tab=payments&connect=done`,
      refresh_url: `${appUrl}/settings?tab=payments&connect=refresh`,
    });
    return NextResponse.json({ url: link.url });
  } catch (e) {
    console.error("[connect/onboard] account link failed:", e);
    return NextResponse.json(
      { error: "stripe_error", detail: stripeDetail(e) },
      { status: 502 },
    );
  }
}

// Pull a readable, non-sensitive reason out of a Stripe error so the owner sees
// WHY connecting failed (e.g. "Connect is not enabled...") instead of a generic
// message. Stripe error messages are designed to be shown to the integrator.
function stripeDetail(e: unknown): string | undefined {
  let detail: string | undefined;
  if (e && typeof e === "object") {
    const err = e as { message?: string; code?: string };
    const parts = [err.message, err.code ? `[${err.code}]` : undefined].filter(
      Boolean,
    );
    if (parts.length) detail = parts.join(" ");
  }
  if (!detail && e instanceof Error) detail = e.message;
  // Never echo anything key-like back to the UI, even though this is owner-only:
  // Stripe's "Invalid API Key" message includes the key value. Redact any
  // sk_/pk_/rk_/mk_/whsec_ token so the reason stays helpful without leaking.
  return detail?.replace(
    /\b(sk|pk|rk|mk|whsec)_[A-Za-z0-9_]+/g,
    "$1_[redacted]",
  );
}
