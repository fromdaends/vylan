import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { UploadCloud, Sparkles, CheckCircle2, Building2, BookOpen } from "lucide-react";
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import { Button } from "@/components/ui/button";
import { listFirmQuickbooksConnectedClients } from "@/lib/db/quickbooks";

// Real-time connection state: never serve a cached "not connected" after a
// client just linked.
export const dynamic = "force-dynamic";

// QuickBooks integrations landing page — the sidebar "QuickBooks" item's home,
// symmetric with the Xero surface. QuickBooks connects PER CLIENT (from each
// client's page), so this page explains that + lists which clients are linked,
// with a button to the client list to connect more. The DRAFTS themselves now
// live in the shared "Bookkeeping" tab, so this page is purely about the
// connection (mirroring integrations/xero).
export default async function QuickbooksIntegrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Integrations");

  const connected = await listFirmQuickbooksConnectedClients();

  const steps = [
    {
      icon: Building2,
      color: "text-icon-blue",
      title: t("qbo_step1_title"),
      desc: t("qbo_step1_desc"),
    },
    {
      icon: UploadCloud,
      color: "text-icon-purple",
      title: t("qbo_step2_title"),
      desc: t("qbo_step2_desc"),
    },
    {
      icon: Sparkles,
      color: "text-icon-emerald",
      title: t("qbo_step3_title"),
      desc: t("qbo_step3_desc"),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-in-up">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#2CA01C]/10 ring-1 ring-inset ring-[#2CA01C]/20">
            <QuickbooksLogo className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("quickbooks_name")}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("qbo_detail_explainer")}
            </p>
          </div>
        </div>
        {/* Jump to the shared Bookkeeping drafts queue (under Engagements). */}
        <Button asChild variant="outline" size="sm" className="shrink-0 gap-2">
          <Link href="/quickbooks/drafts">
            <BookOpen className="h-4 w-4" aria-hidden />
            {t("view_drafts")}
          </Link>
        </Button>
      </header>

      {connected.length === 0 ? (
        <div className="rounded-xl border border-border/50 p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("qbo_none_connected")}
          </p>
          <div className="mt-4">
            <Button asChild className="gap-2">
              <Link href="/clients">
                <QuickbooksLogo className="h-4 w-4" />
                {t("qbo_go_to_clients")}
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {t("qbo_connected_count", { count: connected.length })}
            </p>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/clients">{t("qbo_go_to_clients")}</Link>
            </Button>
          </div>
          <ul className="divide-y divide-border/50 rounded-xl border border-border/50">
            {connected.map((c) => (
              <li key={c.clientId}>
                <Link
                  href={`/clients/${c.clientId}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/50"
                >
                  <span className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    <span className="text-sm font-medium">
                      {c.clientName ?? t("qbo_unknown_client")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.companyName}
                    {c.isSandbox && (
                      <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                        {t("qbo_sandbox_badge")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* How it works — three plain steps, hairline-set-off, no boxes. */}
      <div className="border-t border-border/40 pt-8">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          {t("qbo_how_label")}
        </p>
        <ol className="mt-5 grid gap-7 sm:grid-cols-3 sm:gap-5">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={i} className="flex flex-col gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/60">
                  <Icon className={`size-5 ${step.color}`} aria-hidden />
                </span>
                <div className="space-y-1">
                  <div className="text-sm font-medium leading-snug">
                    {step.title}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {step.desc}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
