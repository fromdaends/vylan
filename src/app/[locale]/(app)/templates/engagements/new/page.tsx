import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listFirmServices } from "@/lib/db/firm-services";
import { getCurrentFirm } from "@/lib/db/firms";
import { EngagementTemplateBuilder } from "@/components/templates/engagement-template-builder";

/**
 * Create Engagement Template.
 *
 * Its own route, not a mode of /engagements/new. The founder: "Theres a builder
 * for engagements and theres one for templates both different. However very
 * similar." Canopy has two screens too, and they ask different questions — a
 * template has no client and no due date, and its period is a RULE rather than
 * a date.
 *
 * The parts that ARE the same (the priced-scope editor, the placeholder
 * resolver, the save action) are imported by the builder rather than rebuilt.
 */
export default async function NewEngagementTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [services, firm] = await Promise.all([
    // The firm's service catalogue (1480). Empty before it is applied, which
    // the items editor treats as an ordinary state.
    listFirmServices(),
    getCurrentFirm(),
  ]);

  return (
    <EngagementTemplateBuilder
      locale={locale}
      services={services}
      fallbackTaxPct={
        (firm as { default_tax_pct?: number | null } | null)?.default_tax_pct ??
        null
      }
    />
  );
}
