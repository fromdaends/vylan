import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { assertLocale } from "@/lib/locale";
import { listFirmServices } from "@/lib/db/firm-services";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
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

  const [template, services, taskTemplates, firm, members, viewer] = await Promise.all([
    getEngagementTemplate(id),
    listFirmServices(),
    listTaskTemplates(),
    getCurrentFirm(),
    listFirmUsers(),
    getCurrentUser(),
  ]);

  // RLS decides visibility, so "not found" and "belongs to somebody else and is
  // private" arrive here identically — which is right, and neither answer leaks
  // the other's existence.
  if (!template) notFound();

  return (
    <EngagementTemplateBuilder
      locale={locale}
      services={services}
      // Without this the Services tab can never say which work a picked
      // service brought — the exact never-wired-prop class of bug that
      // shipped three inert features on the engagement page before.
      taskTemplates={taskTemplates.map((tt) => ({
        id: tt.id,
        name: tt.name,
        steps: tt.payload.subtasks.map((x) => x.title),
      }))}
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
      // NO TAX RATE ON A TEMPLATE, deliberately.
      //
      // The rate comes from the CLIENT's province (lib/tax/canada.ts) and a
      // template has no client — it is reused for an Ontario client and a
      // Quebec one, and baking 13% into it would put the wrong tax on every
      // engagement made from it in the other province. The engagement builder
      // fills the box in once a client is picked.
      //
      // This used to read `firm.default_tax_pct` through a cast. That column
      // exists in no migration, so it was always undefined — the cast was the
      // only thing stopping the compiler from saying so.
      fallbackTaxPct={null}
      initial={{
        id: template.id,
        name: template.name,
        access: template.access,
        payload: template.payload,
      }}
    />
  );
}
