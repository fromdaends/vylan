import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listFirmServices } from "@/lib/db/firm-services";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
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

  const [services, firm, members, viewer] = await Promise.all([
    // The firm's service catalogue (1480). Empty before it is applied, which
    // the items editor treats as an ordinary state.
    listFirmServices(),
    getCurrentFirm(),
    // Who an engagement from this template lands on. Empty in a solo firm,
    // which hides the picker — there is nobody else to hand it to.
    listFirmUsers(),
    getCurrentUser(),
  ]);

  return (
    <EngagementTemplateBuilder
      locale={locale}
      services={services}
      members={members
        .filter((m) => !m.deactivated_at)
        .map((m) => ({ id: m.id, name: userDisplayLabel(m) }))}
      // The firm's standard terms (1610), so a new template's Terms tab is not
      // an empty box on every single one.
      firmDefaultTerms={
        (firm as { default_engagement_terms?: string | null } | null)
          ?.default_engagement_terms ?? ""
      }
      canManageFirmTerms={can(viewer, "firm.settings")}
      fallbackTaxPct={
        (firm as { default_tax_pct?: number | null } | null)?.default_tax_pct ??
        null
      }
    />
  );
}
