import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { Link } from "@/i18n/navigation";
import { UploadCloud, Sparkles, CheckCircle2, Building2 } from "lucide-react";
import { XeroLogo } from "@/components/integrations/xero-logo";
import { Button } from "@/components/ui/button";
import { isXeroConfigured } from "@/lib/xero/client";
import { listFirmXeroConnectedClients } from "@/lib/db/xero";

// Real-time connection state: never serve a cached "not connected" after a
// client just linked.
export const dynamic = "force-dynamic";

// Xero integrations landing page — the sidebar "Xero" item's home, mirroring
// the QuickBooks surface's quality. Xero connects PER CLIENT (from each
// client's page), so this page explains that + lists which clients are linked,
// with a button to the client list to connect more.
export default async function XeroIntegrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Integrations");

  const configured = isXeroConfigured();
  const connected = configured ? await listFirmXeroConnectedClients() : [];

  const steps = [
    {
      icon: Building2,
      color: "text-icon-blue",
      title: t("xero_step1_title"),
      desc: t("xero_step1_desc"),
    },
    {
      icon: UploadCloud,
      color: "text-icon-purple",
      title: t("xero_step2_title"),
      desc: t("xero_step2_desc"),
    },
    {
      icon: Sparkles,
      color: "text-icon-emerald",
      title: t("xero_step3_title"),
      desc: t("xero_step3_desc"),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-in-up">
      <header className="flex items-start gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#13B5EA]/10 ring-1 ring-inset ring-[#13B5EA]/20">
          <XeroLogo className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("xero_name")}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("xero_detail_explainer")}
          </p>
        </div>
      </header>

      {!configured ? (
        <div className="rounded-xl border border-border/50 px-4 py-3 text-sm text-muted-foreground">
          {t("xero_unavailable")}
        </div>
      ) : connected.length === 0 ? (
        <div className="rounded-xl border border-border/50 p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("xero_none_connected")}
          </p>
          <div className="mt-4">
            <Button asChild className="gap-2">
              <Link href="/clients">
                <XeroLogo className="h-4 w-4" />
                {t("xero_go_to_clients")}
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {t("xero_connected_count", { count: connected.length })}
            </p>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/clients">{t("xero_go_to_clients")}</Link>
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
                      {c.clientName ?? t("xero_unknown_client")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.tenantName}
                    {c.isDemo && (
                      <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                        {t("xero_demo_badge")}
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
          {t("xero_how_label")}
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
