import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { cn } from "@/lib/cn";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { getServerSupabase } from "@/lib/supabase/server";
import { firmPaymentRails } from "@/lib/payments/rails";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";
import { listFirmXeroConnectedClients } from "@/lib/db/xero";
import {
  getFirmInvoiceSettings,
  chaseSettingsFrom,
} from "@/lib/db/invoice-settings";
import { formatInvoiceNumber } from "@/lib/invoices/number";
import { listFirmInvoices, INVOICE_PAGE_SIZE } from "@/lib/invoices/list";
import { loadBillingStats } from "@/lib/invoices/stats";
import {
  resolveBillingTab,
  resolveInvoiceFilters,
  billingHref,
  hasAnyFilter,
} from "@/lib/invoices/tabs";
import { InvoiceStatsStrip } from "@/components/invoicing/invoice-stats-strip";
import { InvoiceFilters } from "@/components/invoicing/invoice-filters";
import { InvoicesTable } from "@/components/invoicing/invoices-table";
import { BillingSettings } from "@/components/invoicing/billing-settings";
import { NewInvoiceButton } from "@/components/invoicing/new-invoice-button";

// Billing — every invoice the firm has raised, what is owed, and who is being
// chased. NOT the firm's own Vylan subscription, which lives at
// /settings/billing (it moved there when this section took the route).
//
// Gated on money.view, the capability every other money surface uses. Owners
// and members both have it: billing.manage is the owner-only gate on the
// SUBSCRIPTION page, and using it here would lock staff out of their own job.
export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [me, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!can(me, "money.view")) redirect(`/${locale}/dashboard`);
  if (!firm) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("FirmBilling");
  const tab = resolveBillingTab(sp);
  const tabs = [
    { id: "invoices" as const, label: t("tab_invoices"), href: "/billing" },
    {
      id: "settings" as const,
      label: t("tab_settings"),
      href: "/billing?tab=settings",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl animate-in-fade">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("page_title")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            {t("page_subtitle")}
          </p>
        </div>
        {tab === "invoices" && <NewInvoiceButton />}
      </header>

      <nav
        aria-label={t("page_title")}
        className="mb-6 flex items-center gap-6 border-b border-border"
      >
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {tab === "settings" ? (
        <SettingsTab />
      ) : (
        <InvoicesTab sp={sp} locale={locale} />
      )}
    </div>
  );
}

async function InvoicesTab({
  sp,
  locale,
}: {
  sp: Record<string, string | undefined>;
  locale: "en" | "fr";
}) {
  const t = await getTranslations("FirmBilling");
  const filters = resolveInvoiceFilters(sp);

  const [stats, list, clients] = await Promise.all([
    loadBillingStats(),
    listFirmInvoices(filters),
    listClientsForFilter(),
  ]);

  const appUrl = process.env.APP_URL ?? "";

  return (
    <>
      <InvoiceStatsStrip stats={stats} locale={locale} />

      {/* Says plainly that the database is behind the code, rather than
          letting partial payments and reminders look broken. */}
      {list.migrationPending && (
        <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          {t("migration_banner")}
        </p>
      )}

      <InvoiceFilters filters={filters} clients={clients} />

      {list.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-6 py-14 text-center">
          <p className="text-sm font-medium">
            {hasAnyFilter(filters) ? t("empty_filtered_title") : t("empty_title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasAnyFilter(filters) ? t("empty_filtered_body") : t("empty_body")}
          </p>
        </div>
      ) : (
        <>
          <InvoicesTable rows={list.rows} portalBase={appUrl} />

          {(list.page > 1 || list.hasNext) && (
            <nav
              className="mt-4 flex items-center justify-between"
              aria-label={t("page_number", { page: list.page })}
            >
              <PageLink
                href={billingHref(filters, { page: list.page - 1 })}
                disabled={list.page <= 1}
                label={t("page_prev")}
              />
              <span className="text-xs text-muted-foreground">
                {t("page_number", { page: list.page })}
              </span>
              <PageLink
                href={billingHref(filters, { page: list.page + 1 })}
                disabled={!list.hasNext}
                label={t("page_next")}
              />
            </nav>
          )}
        </>
      )}
    </>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="text-sm text-muted-foreground/50">{label}</span>
    );
  }
  return (
    <Link
      href={href}
      className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
    </Link>
  );
}

// Clients that actually have an invoice — filtering by a client with nothing to
// show is a dead end, and a firm with 300 clients does not want all 300 in a
// dropdown that only 40 of them can populate.
async function listClientsForFilter(): Promise<
  { id: string; name: string }[]
> {
  const sb = await getServerSupabase();
  const { data: invoiced } = await sb
    .from("payment_requests")
    .select("client_id")
    .not("client_id", "is", null);
  const ids = [
    ...new Set((invoiced ?? []).map((r) => r.client_id as string)),
  ];
  if (ids.length === 0) return [];
  const { data } = await sb
    .from("clients")
    .select("id, display_name")
    .in("id", ids)
    .order("display_name");
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.display_name as string,
  }));
}

async function SettingsTab() {
  // QuickBooks and Xero connect PER CLIENT in Vylan, not per firm — which is
  // itself the reason the bookkeeping card here says what it says. "Connected"
  // means the firm has at least one client's ledger linked; it has never meant
  // the firm's OWN books are wired up, because they are not.
  const [firm, settings, qboClients, xeroClients] = await Promise.all([
    getCurrentFirm(),
    getFirmInvoiceSettings(),
    listFirmQuickbooksConnectedClients(),
    listFirmXeroConnectedClients(),
  ]);
  const rails = firmPaymentRails(firm ?? {});
  const chase = chaseSettingsFrom(settings);

  return (
    <BillingSettings
      chase={chase}
      taxProvince={settings?.province ?? null}
      invoicingConfigured={Boolean(settings)}
      numbering={
        settings
          ? {
              prefix: settings.invoice_prefix,
              nextNumber: formatInvoiceNumber(
                settings.invoice_prefix,
                settings.next_invoice_seq,
              ),
            }
          : null
      }
      rails={{ stripe: rails.stripe, paypal: rails.paypal }}
      books={{
        quickbooks: qboClients.length > 0,
        xero: xeroClients.length > 0,
      }}
    />
  );
}

export { INVOICE_PAGE_SIZE };
