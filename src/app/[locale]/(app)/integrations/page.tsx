import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { firmHasAnyQuickbooksConnection } from "@/lib/db/quickbooks";
import { firmHasAnyXeroConnection } from "@/lib/db/xero";
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import { XeroLogo } from "@/components/integrations/xero-logo";
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

  // The QuickBooks card is ALWAYS shown so the integration is discoverable — it
  // just reads "Not connected" until a client is linked (the founder's call).
  // Connecting happens per client (from a client's page); opening the card lands
  // on the QuickBooks surface, which guides the owner there when nothing's linked.
  const qbConnected = await firmHasAnyQuickbooksConnection();
  const xeroConnected = await firmHasAnyXeroConnection();

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
        {/* QuickBooks — live integration. ALWAYS shown (reads "Not connected"
            until a client is linked) so it's discoverable. Opens the QuickBooks
            connect page (drafts now live in the shared Bookkeeping tab). */}
        <IntegrationCard
          href="/integrations/quickbooks"
          logo={<QuickbooksLogo className="h-7 w-7" />}
          tileClassName="bg-[#2CA01C]/10 ring-[#2CA01C]/20"
          name={t("quickbooks_name")}
          description={t("quickbooks_desc")}
          badge={
            qbConnected
              ? { label: t("state_connected"), tone: "success" }
              : { label: t("state_not_connected"), tone: "muted" }
          }
          actionLabel={t("action_open")}
        />

        {/* Xero — live integration, the QuickBooks sibling. Always shown
            ("Not connected" until a client links); opens the Xero connect page
            (which explains per-client connecting and lists linked clients). */}
        <IntegrationCard
          href="/integrations/xero"
          logo={<XeroLogo className="h-7 w-7" />}
          tileClassName="bg-[#13B5EA]/10 ring-[#13B5EA]/20"
          name={t("xero_name")}
          description={t("xero_desc")}
          badge={
            xeroConnected
              ? { label: t("state_connected"), tone: "success" }
              : { label: t("state_not_connected"), tone: "muted" }
          }
          actionLabel={xeroConnected ? t("action_open") : t("xero_action_connect")}
        />

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
