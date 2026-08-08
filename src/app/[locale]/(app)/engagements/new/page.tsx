import { setRequestLocale } from "next-intl/server";
import { listClients } from "@/lib/db/clients";
import { listLiveRelationshipsForFirm } from "@/lib/db/relationships";
import type { ScopeWarningContact } from "@/lib/relationships/validate";
import { listTemplates } from "@/lib/db/templates";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { EngagementBuilder } from "@/components/engagements/engagement-builder";
import { assertLocale } from "@/lib/locale";
import { getFirmReminderDefault } from "@/lib/reminder-defaults";
import { can } from "@/lib/auth/capabilities";
import { isSignwellEmbeddedEditingEnabled } from "@/lib/signwell/client";
import { listFirmServices } from "@/lib/db/firm-services";
import { listEngagementTemplates } from "@/lib/db/engagement-templates";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { listAutomations } from "@/lib/db/automations";
import { getServiceIdsWithLetters } from "@/app/actions/engagement-letters";

/**
 * The new-engagement screen, rendered by BOTH entry points:
 *
 *   - as an OVERLAY over whatever page you were on, via the @modal
 *     intercepting route — the normal case, and what the founder asked for:
 *     "a box that appears overlapping over the UI that already exists".
 *   - as a full page, on a direct load, a refresh, or a shared link, where
 *     there is no page behind to overlay.
 *
 * One implementation, two frames. A second copy of this would be the exact
 * drift CLAUDE.md's cohesion rule exists to prevent, and this one loads seven
 * things and threads a dozen props.
 */
export default async function NewEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    client?: string;
    template?: string;
    /** A saved WHOLE engagement (1500), from "Use" on the Templates page.
     *  Distinct from `template`, which is a document request. */
    engagement_template?: string;
  }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [
    clients,
    templates,
    firm,
    user,
    firmRelationships,
    services,
    engagementTemplates,
    taskTemplates,
    members,
    automations,
    serviceIdsWithLetters,
  ] =
    await Promise.all([
      listClients({ includeArchived: false }),
      listTemplates(),
      getCurrentFirm(),
      getCurrentUser(),
      listLiveRelationshipsForFirm(),
      // The firm's service catalogue (migration 1480). An empty list before it
      // is applied, which the items step treats as an ordinary state.
      listFirmServices(),
      // Saved whole-engagement templates (migration 1500). Empty before it is
      // applied, which makes the start chooser skip itself.
      listEngagementTemplates(),
      // Saved sets of tasks (migration 1570), for the Tasks step's picker.
      // Empty before it is applied, which hides the picker.
      listTaskTemplates(),
      // Who the work can be handed to at creation. The save path has accepted
      // assigned_user_id since 0001 — the form simply never offered it, which
      // is why assigning was always a SECOND step after creating.
      listFirmUsers(),
      // The flows library (1560), for the Automation step's picker. Empty
      // pre-migration; the step itself only renders when the switch is on.
      listAutomations(),
      // Which services carry an engagement letter (1700) — the step's honesty
      // line about sends that would be skipped.
      getServiceIdsWithLetters(),
    ]);

  // Recipient safety (relationships spec §3): each business client's linked
  // authorized contacts. Live links only reference unarchived clients (the
  // archive cascade hides the rest), so names resolve from the list above.
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const authorizedContacts: Record<string, ScopeWarningContact[]> = {};
  for (const r of firmRelationships) {
    if (r.rel_type !== "authorized_contact") continue;
    const contact = clientById.get(r.from_client_id);
    if (!contact) continue;
    (authorizedContacts[r.to_client_id] ??= []).push({
      clientId: contact.id,
      name: contact.display_name,
      email: contact.email,
      scopes: r.scopes ?? [],
    });
  }

  return (
    // FULL WIDTH, like Clients and Work. It was max-w-3xl — 768px — which was
    // fine for one column of stacked cards and became the whole problem the
    // moment a step rail took 15rem out of it: the form had ~500px to live in
    // while half the screen sat empty. Founder: "why is the list ui so skinny".
    //
    // Capped at 1400px rather than truly edge-to-edge so the rail and the form
    // stay a readable distance apart on an ultrawide monitor.
    // No page header or breadcrumb any more: the shell draws its own title bar
    // with the actions in it, the way Canopy's modal does. A page heading above
    // a modal-looking card would name the same thing twice.
    <EngagementBuilder
        clients={clients.map((c) => ({
          id: c.id,
          display_name: c.display_name,
          type: c.type,
          email: c.email,
          province: c.province,
        }))}
        templates={templates}
        initialClientId={sp.client}
        initialTemplateId={sp.template}
        // Arriving with a saved engagement already chosen skips the start
        // chooser — the choice it asks for has been made.
        initialEngagementTemplateId={sp.engagement_template}
        locale={locale}
        includeQuebecForms={firm?.include_quebec_forms ?? true}
        // The sales-tax FALLBACK (1750), for the 96% of clients with no
        // province of their own. `?? null` because this ships before the
        // migration is applied and a missing column must read as "not set".
        firmProvince={firm?.province ?? null}
        servicePrices={firm?.service_prices ?? {}}
        connectReady={firm?.connect_charges_enabled === true}
        invoiceDefaultMode={firm?.default_invoice_auto_mode ?? "off"}
        invoiceDefaultDelayDays={firm?.default_invoice_delay_days ?? null}
        reminderDefaultSettings={getFirmReminderDefault(firm)}
        canManageReminderDefaults={can(user, "firm.settings")}
        canManageFirmTerms={can(user, "firm.settings")}
        // The firm's standard terms (1610) — what makes an engagement built
        // WITHOUT a template still a real proposal rather than a price list.
        firmDefaultTerms={
          (firm as { default_engagement_terms?: string | null } | null)
            ?.default_engagement_terms ?? ""
        }
        authorizedContacts={authorizedContacts}
        // The firm's service catalogue (1480). Without this the Service
        // dropdown on an engagement item never appears.
        // Each service carries the work it implies (1620), so picking one on
        // the Services step brings its tasks in.
        services={services.map((svc) => {
          const tpl = svc.taskTemplateId
            ? taskTemplates.find((tt) => tt.id === svc.taskTemplateId)
            : undefined;
          return {
            id: svc.id,
            name: svc.name,
            description: svc.description,
            rateCents: svc.rateCents,
            rateType: svc.rateType,
            billingFrequency: svc.billingFrequency,
            taxPct: svc.taxPct,
            // How long it usually takes (1790), so picking the service fills
            // the line's Hours box the same way it fills the rate (1820).
            budgetMinutes: svc.budgetMinutes,
            work: tpl
              ? {
                  templateId: tpl.id,
                  name: tpl.name,
                  kind: tpl.payload.kind,
                  stepCount: tpl.payload.subtasks.length,
                }
              : null,
          };
        })}
        // Saved whole-engagement templates (1500). Without this the start
        // chooser can never offer one.
        engagementTemplates={engagementTemplates.map((x) => ({
          id: x.id,
          name: x.name,
          access: x.access,
          payload: x.payload,
        }))}
        // Saved sets of tasks (1570). Without this the Tasks step's template
        // picker never appears — the exact class of never-wired prop that
        // shipped three inert features on this page before.
        taskTemplates={taskTemplates.map((x) => ({
          id: x.id,
          name: x.name,
          // Canopy's shape: a parent task with steps under it, plus the
          // client request the parent carries — so applying the template also
          // fills the checklist.
          kind: x.payload.kind,
          subtasks: x.payload.subtasks,
          checklist: x.payload.checklist,
        }))}
        // Active firm members, for the assignee picker.
        members={members
          .filter((m) => !m.deactivated_at)
          .map((m) => ({ id: m.id, name: userDisplayLabel(m) }))}
        workflowsOn={
          (firm as { workflows_enabled?: boolean } | null)
            ?.workflows_enabled === true
        }
        automations={automations.map((a) => ({
          id: a.id,
          firmId: a.firmId,
          name: a.name,
          definition: a.definition,
        }))}
        serviceIdsWithLetters={serviceIdsWithLetters}
        // Inline letter attach on the Automation step — same capability the
        // upload action enforces.
        canUploadLetters={can(user, "firm.settings")}
        // Field placement is available only with the SignWell editor app id.
        signwellEditorOn={isSignwellEmbeddedEditingEnabled()}
      />
  );
}

