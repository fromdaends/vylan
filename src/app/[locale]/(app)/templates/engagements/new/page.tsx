import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listFirmServices } from "@/lib/db/firm-services";
import { listTaskTemplates } from "@/lib/db/task-templates";
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

  const [services, taskTemplates, firm, members, viewer] = await Promise.all([
    // The firm's service catalogue (1480). Empty before it is applied, which
    // the items editor treats as an ordinary state.
    listFirmServices(),
    // The firm's task templates (1570) — a service names the work it
    // implies, and the Services tab shows what a picked service brought.
    listTaskTemplates(),
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
    />
  );
}
