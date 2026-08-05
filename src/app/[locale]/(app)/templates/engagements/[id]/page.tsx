import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { assertLocale } from "@/lib/locale";
import { listFirmServices } from "@/lib/db/firm-services";
import { getCurrentFirm } from "@/lib/db/firms";
import { listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { getEngagementTemplate } from "@/lib/db/engagement-templates";
import { EngagementTemplateBuilder } from "@/components/templates/engagement-template-builder";

/**
 * Edit an engagement template.
 *
 * The SAME builder that creates one, seeded with the template. The founder:
 * "The option to view and edit your templates should be an option too."
 *
 * A second edit screen would be a second place for twenty fields to drift, so
 * the builder takes an `initial` and the only difference is its title and
 * whether it saves an id.
 */
export default async function EditEngagementTemplatePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [template, services, firm, members] = await Promise.all([
    getEngagementTemplate(id),
    listFirmServices(),
    getCurrentFirm(),
    listFirmUsers(),
  ]);

  // RLS decides visibility, so "not found" and "belongs to somebody else and is
  // private" arrive here identically — which is right, and neither answer leaks
  // the other's existence.
  if (!template) notFound();

  return (
    <EngagementTemplateBuilder
      locale={locale}
      services={services}
      members={members
        .filter((m) => !m.deactivated_at)
        .map((m) => ({ id: m.id, name: userDisplayLabel(m) }))}
      fallbackTaxPct={
        (firm as { default_tax_pct?: number | null } | null)?.default_tax_pct ??
        null
      }
      initial={{
        id: template.id,
        name: template.name,
        access: template.access,
        payload: template.payload,
      }}
    />
  );
}
