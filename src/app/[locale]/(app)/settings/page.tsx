import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { isTrialExpired, trialDaysLeft } from "@/lib/trial";
import { getFirmAiUsage } from "@/lib/ai/usage";
import { getBrandingImageUrl } from "@/lib/storage";
import { assertLocale } from "@/lib/locale";
import { isStripeConfigured } from "@/lib/stripe";
import { syncFirmConnectStatusFromStripe } from "@/lib/db/stripe-connect";
import { isPayPalConfigured, paypalEnvironment } from "@/lib/paypal/config";
import { syncFirmPayPalStatus } from "@/lib/db/paypal-connect";
import {
  isQuickbooksConfigured,
  quickbooksEnvironment,
} from "@/lib/quickbooks/client";
import { getFirmQuickbooksStatus } from "@/lib/db/quickbooks";
import { getQuickbooksConnectionHealth } from "@/lib/quickbooks/connection";
import { listFirmPaymentsWithNames } from "@/lib/db/payment-requests";
import { SettingsShell } from "./settings-form";
import { TrialStatusCard } from "@/components/app/trial-status-card";
import { SubscriptionCard } from "@/components/billing/subscription-card";
import { getFirmReminderDefault } from "@/lib/reminder-defaults";

export const dynamic = "force-dynamic";

// /settings: a sectioned settings surface (sub-nav on the left, the selected
// category on the right). Categories: Account (email + password sign-in +
// firm settings), Security & privacy (two-factor for everyone, plus the
// owner-only audit log / export / delete tools), General (mode, language, and
// timezone), Billing (subscription, owner-only), Documents
// (auto-reject). ?tab=<section> deep-links a category (used by the avatar
// menu + the old /firm redirect).
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    tab?: string;
    connect?: string;
    qbo?: string;
    paypal?: string;
  }>;
}) {
  const { locale: rawLocale } = await params;
  const {
    tab,
    connect: connectParam,
    qbo: qboParam,
    paypal: paypalParam,
  } = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }
  const [user, firm, mfaFactors] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (!user || !firm) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const firmLogoUrl = await getBrandingImageUrl(firm.logo_url);
  // AI monthly-cap usage for the Documents tab status (point-read; resilient
  // pre-migration — defaults to 0 used / not paused).
  const aiUsage = await getFirmAiUsage(firm.id);
  // MFA is "enabled" only with a verified TOTP factor (unverified = mid-enroll).
  const mfaEnabled = (mfaFactors.data?.totp ?? []).some(
    (f) => f.status === "verified",
  );

  const t = await getTranslations("Settings");
  const isOwner = user.role === "owner";

  // Free-trial status card state (owner-only, unconverted trial firms).
  // The helpers default "now" internally (keeps Date.now() out of render).
  const trialExpired = isTrialExpired(firm);
  const trialDays = trialDaysLeft(firm);

  // The subscription summary is an async server component; render it here and
  // hand it to the (client) settings shell as a slot for the Billing tab.
  const billingSlot = isOwner ? (
    <SubscriptionCard
      plan={firm.plan}
      subscriptionStatus={firm.subscription_status}
      currentPeriodEnd={firm.current_period_end}
      stripeCustomerId={firm.stripe_customer_id}
      locale={locale}
    />
  ) : null;

  // Stripe Connect status for the owner-only "Get paid by clients" block in the
  // Payments section. The connect_* fields may be undefined until migration 0370
  // is applied (remote DB) — `=== true` / `?? null` default to "not connected".
  const stripeReady = isStripeConfigured();
  const connectAccountId = firm.stripe_connect_account_id ?? null;
  let connectChargesEnabled = firm.connect_charges_enabled === true;
  let connectDetailsSubmitted = firm.connect_details_submitted === true;
  // Self-heal: if a connected account exists but charges aren't enabled yet (the
  // "Almost there" state, e.g. just back from onboarding), pull the live status
  // straight from Stripe instead of waiting on the account.updated webhook.
  if (isOwner && stripeReady && connectAccountId && !connectChargesEnabled) {
    const synced = await syncFirmConnectStatusFromStripe(connectAccountId);
    if (synced) {
      connectChargesEnabled = synced.connect_charges_enabled;
      connectDetailsSubmitted = synced.connect_details_submitted;
    }
  }
  const connect = isOwner
    ? {
        configured: stripeReady,
        accountId: connectAccountId,
        chargesEnabled: connectChargesEnabled,
        detailsSubmitted: connectDetailsSubmitted,
        onboardedAt: firm.connect_onboarded_at ?? null,
        justReturned: connectParam === "done",
      }
    : null;

  // PayPal connection status for the second provider card (owner-only, 0730).
  // The paypal_* columns ride along on getCurrentFirm's select("*"); typed via
  // a cast because the Firm type predates them. ?paypal=<status> is set by the
  // onboarding callback redirect.
  const firmPayPal = firm as typeof firm & {
    paypal_merchant_id?: string | null;
    paypal_payments_receivable?: boolean | null;
    paypal_email_confirmed?: boolean | null;
  };
  const paypalAllowed = [
    "done",
    "pending",
    "partnerid",
    "linked",
    "clobber",
    "error",
  ] as const;
  const paypalCallbackStatus = paypalAllowed.includes(
    paypalParam as (typeof paypalAllowed)[number],
  )
    ? (paypalParam as (typeof paypalAllowed)[number])
    : null;
  const paypalMerchantId = firmPayPal.paypal_merchant_id ?? null;
  let paypalReceivable = firmPayPal.paypal_payments_receivable === true;
  let paypalEmailConfirmed = firmPayPal.paypal_email_confirmed === true;
  // Self-heal, mirroring Stripe above: a linked-but-not-ready account pulls the
  // live status straight from PayPal instead of waiting on a webhook.
  if (
    isOwner &&
    isPayPalConfigured() &&
    paypalMerchantId &&
    !(paypalReceivable && paypalEmailConfirmed)
  ) {
    const synced = await syncFirmPayPalStatus(firm.id, paypalMerchantId);
    if (synced) {
      paypalReceivable = synced.paymentsReceivable;
      paypalEmailConfirmed = synced.primaryEmailConfirmed;
    }
  }
  const paypal = isOwner
    ? {
        configured: isPayPalConfigured(),
        merchantId: paypalMerchantId,
        paymentsReceivable: paypalReceivable,
        emailConfirmed: paypalEmailConfirmed,
        environment: paypalEnvironment(),
        callbackStatus: paypalCallbackStatus,
      }
    : null;

  // QuickBooks (Intuit) connection status for the owner-only Integrations
  // section. Reads the firm's connection (RLS-scoped; the tokens are not even
  // selectable) and defaults gracefully to "not connected" before migration 0410
  // is applied. The ?qbo=<status> flag is set by the OAuth callback.
  const qboCallbackAllowed = ["done", "denied", "error", "setup", "enc"] as const;
  const qboCallbackStatus = qboCallbackAllowed.includes(
    qboParam as (typeof qboCallbackAllowed)[number],
  )
    ? (qboParam as (typeof qboCallbackAllowed)[number])
    : null;
  // Status + read access are available to ANY firm member (connect/disconnect are
  // gated to owners inside IntegrationsSection). getFirmQuickbooksStatus reads via
  // RLS, so a staff member sees only their own firm's connection.
  const qboConnection = await getFirmQuickbooksStatus();
  // Connection health: refreshes a stale token as a side effect (the keep-alive)
  // AND detects a DEAD connection (expired/revoked refresh token) so the
  // Integrations card can show "reconnect needed" instead of a false green
  // "Connected". Best-effort; never blocks the page on failure.
  const qboHealth = qboConnection?.connected
    ? await getQuickbooksConnectionHealth(firm.id)
    : "ok";
  const quickbooks = {
    configured: isQuickbooksConfigured(),
    connected: Boolean(qboConnection?.connected),
    needsReconnect: qboHealth === "reconnect_required",
    companyName: qboConnection?.companyName ?? null,
    realmId: qboConnection?.realmId ?? null,
    environment: qboConnection?.environment ?? quickbooksEnvironment(),
    callbackStatus: qboCallbackStatus,
  };

  // Per-service default prices for the Payments settings editor (owner-only).
  // Defaults to {} until migration 0380 is applied (column absent -> undefined).
  const servicePrices = isOwner ? (firm.service_prices ?? {}) : null;
  // Firm-wide recent payments for the Payments settings list (owner-only).
  const paymentsList = isOwner ? await listFirmPaymentsWithNames() : null;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      {/* Free-trial status — owner-only, only while the firm is an unconverted
          trial. Surfaces days-left + a booking CTA (no free self-upgrade).
          Sits above the sectioned settings so it can't be missed. */}
      {firm.is_demo && user.role === "owner" && (
        <TrialStatusCard expired={trialExpired} daysLeft={trialDays} />
      )}

      <SettingsShell
        currentLocale={user.locale}
        currentTimezone={firm.timezone}
        autoRejectUnusableDocs={firm.auto_reject_unusable_docs}
        autoRejectDuplicates={firm.auto_reject_duplicates}
        autoRequestMissingPages={firm.auto_request_missing_pages}
        includeQuebecForms={firm.include_quebec_forms ?? true}
        chatConfirmActions={firm.chat_confirm_actions ?? true}
        invoiceDefaultMode={firm.default_invoice_auto_mode ?? "off"}
        invoiceDefaultDelayDays={firm.default_invoice_delay_days ?? null}
        reminderDefaultSettings={getFirmReminderDefault(firm)}
        aiUsage={aiUsage}
        isOwner={isOwner}
        billingSlot={billingSlot}
        connect={connect}
        paypal={paypal}
        quickbooks={quickbooks}
        servicePrices={servicePrices}
        paymentsList={paymentsList}
        currentUserId={user.id}
        firmName={firm.name}
        firm={{
          name: firm.name,
          brand_color: firm.brand_color,
          locale_default: firm.locale_default,
        }}
        firmLogoUrl={firmLogoUrl}
        email={user.email}
        mfaEnabled={mfaEnabled}
        initialSection={tab}
      />
    </div>
  );
}
