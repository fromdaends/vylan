"use client";

// The firm's SERVICE CATALOGUE — what you sell, defined once. LIST ONLY.
//
// The founder's framing, which is also the test for whether this is worth
// having: "Monthly bookkeeping, $400/mo, creates these 6 tasks — defined once
// and dropped onto any client." Without it you retype every line on every
// engagement, and there is nothing for tasks to hang off.
//
// A service is a TEMPLATE for an engagement item. Using one COPIES its values
// onto the engagement, where they can be changed for that client without
// touching the catalogue — the founder's call: picking a service SUGGESTS the
// price, it does not lock it. That is also why editing a service here never
// rewrites a proposal a client has already agreed to.
//
// ── WHY THE FORM LEFT THIS FILE ────────────────────────────────────────────
//
// It used to open a modal dialog — a third chrome for the same act, after the
// engagement template's full screen and the task template's unfolding card.
// The founder: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES SHOULD ALL BE THE
// SAME. STOP BUILDING INCONSISTENT THINGS."
//
// Authoring moved to /templates/services/new and /templates/services/<id> on
// TemplateBuilderShell. What is left here is the list.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import {
  TemplateRow,
  TemplateRowList,
} from "@/components/templates/template-row";
import { Button } from "@/components/ui/button";
import { archiveFirmServiceAction } from "@/app/actions/firm-services";
import type { BillingFrequency, RateType } from "@/lib/engagements/items";
import { formatCurrency, type AppLocale } from "@/lib/format";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  rateCents: number | null;
  rateType: RateType;
  billingFrequency: BillingFrequency;
  taxPct: number | null;
  /** The work this service implies (1620). Null = it carries none. */
  taskTemplateId: string | null;
  archivedAt: string | null;
};

type FreqKey =
  | "item_freq_once"
  | "item_freq_weekly"
  | "item_freq_monthly"
  | "item_freq_quarterly"
  | "item_freq_yearly";

export function ServiceCatalogue({
  services,
  taskTemplates = [],
  locale,
  canManage,
}: {
  services: ServiceRow[];
  /** The firm's task templates (1570), so a row can say which work it brings. */
  taskTemplates?: { id: string; name: string; steps: string[] }[];
  locale: AppLocale;
  canManage: boolean;
}) {
  const t = useTranslations("Engagements");
  // A SECOND translator, for this file's own Templates-namespace copy. The
  // service labels are shared with the engagement items editor and live under
  // Engagements; the work-link copy is this screen's own and lives under
  // Templates. Reading both from one translator is what printed
  // `Engagements.service_does_work` on screen.
  const tT = useTranslations("Templates");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggleArchive(service: ServiceRow) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await archiveFirmServiceAction(
        service.id,
        service.archivedAt == null,
      );
      if (res.ok) startTransition(() => router.refresh());
      else
        toast.error(
          res.needsMigration
            ? t("services_needs_migration")
            : t("services_failed"),
        );
    } finally {
      setBusy(false);
    }
  }

  function priceLabel(s: ServiceRow): string {
    if (s.rateCents == null) return t("services_price_tbd");
    const money = formatCurrency(s.rateCents / 100, locale);
    const per = s.rateType === "hour" ? t("item_rate_hour").toLowerCase() : null;
    const freq =
      s.billingFrequency === "once"
        ? null
        : t(`item_freq_${s.billingFrequency}` as FreqKey).toLowerCase();
    return [money, per ? `/ ${per}` : null, freq].filter(Boolean).join(" ");
  }

  return (
    <div className="space-y-3">
      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("services_empty")}</p>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              asChild
            >
              <Link href="/templates/services/new">
                <Plus className="size-4" aria-hidden />
                {t("services_add")}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <TemplateRowList>
            {services.map((s) => (
              <TemplateRow
                key={s.id}
                icon={Receipt}
                name={s.name}
                // Price, then the work it implies, then the description. The
                // link has to read from BOTH ends: the catalogue says which
                // work a service brings, and the engagement says which service
                // brought each task.
                meta={[
                  priceLabel(s),
                  s.taskTemplateId
                    ? tT("service_does_work_meta", {
                        name:
                          taskTemplates.find((tt) => tt.id === s.taskTemplateId)
                            ?.name ?? "",
                      })
                    : "",
                  s.description ?? "",
                ]
                  .filter(Boolean)
                  .join(" — ")}
                dimmed={s.archivedAt != null}
                // Clicking IS editing, the same as every other template type.
                href={canManage ? `/templates/services/${s.id}` : undefined}
                badges={
                  s.archivedAt ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
                      {tT("services_archived_badge")}
                    </span>
                  ) : null
                }
                actions={
                  canManage
                    ? [
                        {
                          label: t("services_edit"),
                          onSelect: () =>
                            router.push(`/templates/services/${s.id}`),
                        },
                        {
                          label: s.archivedAt
                            ? t("services_restore")
                            : t("services_archive"),
                          destructive: s.archivedAt == null,
                          onSelect: () => toggleArchive(s),
                        },
                      ]
                    : []
                }
              />
            ))}
          </TemplateRowList>
          {canManage && (
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/templates/services/new">
                <Plus className="size-4" aria-hidden />
                {t("services_add")}
              </Link>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
