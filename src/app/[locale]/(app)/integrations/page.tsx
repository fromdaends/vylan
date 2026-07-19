import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { firmHasAnyQuickbooksConnection } from "@/lib/db/quickbooks";
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import { SageLogo } from "@/components/integrations/sage-logo";
import { IntegrationCard } from "@/components/integrations/integration-card";

// Real-time connection state: never serve a cached "Not connected" after the
// firm just linked QuickBooks.
export const dynamic = "force-dynamic";

// The Integrations hub index — a card grid that scales as more tools are added.
// Each card is an independent integration:
//   - QuickBooks (live connection) -> opens the existing QuickBooks page.
//   - Sage 50 (file export, nothing to connect to) -> opens the Sage page.
// The two share no state; QuickBooks being connected or not has no bearing on
// Sage. Connect/disconnect for QuickBooks still lives in Settings.
export default async function IntegrationsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Integrations");

  // The QuickBooks card appears only once the firm actually uses QuickBooks (any
  // client connected). Before that there's nothing to open, and connecting lives
  // in Settings → Integrations — so the hub isn't cluttered for non-QBO firms.
  const qbConnected = await firmHasAnyQuickbooksConnection();

  return (
    <div className="mx-auto max-w-4xl animate-in-fade">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("index_title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          {t("index_subtitle")}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* QuickBooks — live integration. Shown only once the firm has connected
            a client (connecting lives in Settings → Integrations). Opens the
            drafts queue. */}
        {qbConnected && (
          <IntegrationCard
            href="/quickbooks/drafts"
            logo={<QuickbooksLogo className="h-7 w-7" />}
            tileClassName="bg-[#2CA01C]/10 ring-[#2CA01C]/20"
            name={t("quickbooks_name")}
            description={t("quickbooks_desc")}
            badge={{ label: t("state_connected"), tone: "success" }}
            actionLabel={t("action_open")}
          />
        )}

        {/* Sage 50 — file export. No connection state (Sage 50 is desktop
            software with no live API); the card advertises a downloadable file. */}
        <IntegrationCard
          href="/integrations/sage"
          logo={<SageLogo className="h-7 w-7" />}
          tileClassName="bg-[#00D639]/10 ring-[#00D639]/25"
          name={t("sage_name")}
          description={t("sage_desc")}
          badge={{ label: t("sage_badge"), tone: "muted" }}
          actionLabel={t("sage_action")}
        />
      </div>
    </div>
  );
}
