import { getTranslations } from "next-intl/server";
import { firmHasAnyQuickbooksConnection } from "@/lib/db/quickbooks";
import { firmHasAnyXeroConnection } from "@/lib/db/xero";
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import { XeroLogo } from "@/components/integrations/xero-logo";
import { SageLogo } from "@/components/integrations/sage-logo";
import { IntegrationCard } from "@/components/integrations/integration-card";

// The third-party connection cards (QuickBooks, Xero, Sage) — the real
// Integrations hub. These used to live on a standalone /integrations page with
// its own sidebar tab; the founder retired that tab ("no point in it being in
// the sidebar"), so the cards now render INSIDE Settings > Integrations and
// /integrations redirects there.
//
// An async server component, handed to the (client) settings shell as a slot —
// the same pattern billingSlot / repeatingSlot already use — because the badges
// need real connection state and the shell itself is a client component.
export async function IntegrationsCards() {
  const t = await getTranslations("Integrations");

  // Both cards are ALWAYS shown so each integration stays discoverable — they
  // simply read "Not connected" until a client is linked (the founder's call).
  // Connecting happens per client, from that client's own page.
  const [qbConnected, xeroConnected] = await Promise.all([
    firmHasAnyQuickbooksConnection(),
    firmHasAnyXeroConnection(),
  ]);

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {/* QuickBooks — live integration. Opens the QuickBooks surface, which
          guides the owner to a client page when nothing's linked (drafts live
          in the shared Bookkeeping tab). */}
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

      {/* Xero — the QuickBooks sibling. Opens the Xero connect page, which
          explains per-client connecting and lists linked clients. */}
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

      {/* Document filing deliberately has no card: it's a Vylan-native feature,
          not a third-party connection, and it lives in the Vylan hub now. */}
    </div>
  );
}
