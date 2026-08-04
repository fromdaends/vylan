import { getTranslations, setRequestLocale } from "next-intl/server";
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
import { listFirmServices } from "@/lib/db/firm-services";
import { listEngagementTemplates } from "@/lib/db/engagement-templates";

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
export async function NewEngagementScreen({
  params,
  searchParams,
  overlay = false,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client?: string; template?: string }>;
  overlay?: boolean;
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
    members,
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
      // Who the work can be handed to at creation. The save path has accepted
      // assigned_user_id since 0001 — the form simply never offered it, which
      // is why assigning was always a SECOND step after creating.
      listFirmUsers(),
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

  const t = await getTranslations("Engagements");

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
        overlay={overlay}
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
        locale={locale}
        includeQuebecForms={firm?.include_quebec_forms ?? true}
        servicePrices={firm?.service_prices ?? {}}
        connectReady={firm?.connect_charges_enabled === true}
        invoiceDefaultMode={firm?.default_invoice_auto_mode ?? "off"}
        invoiceDefaultDelayDays={firm?.default_invoice_delay_days ?? null}
        reminderDefaultSettings={getFirmReminderDefault(firm)}
        canManageReminderDefaults={can(user, "firm.settings")}
        authorizedContacts={authorizedContacts}
        // The firm's service catalogue (1480). Without this the Service
        // dropdown on an engagement item never appears.
        services={services}
        // Saved whole-engagement templates (1500). Without this the start
        // chooser can never offer one.
        engagementTemplates={engagementTemplates.map((x) => ({
          id: x.id,
          name: x.name,
          access: x.access,
          payload: x.payload,
        }))}
        // Active firm members, for the assignee picker.
        members={members
          .filter((m) => !m.deactivated_at)
          .map((m) => ({ id: m.id, name: userDisplayLabel(m) }))}
      />
  );
}

// Direct load, refresh, or a shared link: there is no page behind to overlay,
// so this renders full-screen. The @modal intercepting route handles every
// in-app navigation and renders the SAME screen as an overlay.
export default async function NewEngagementPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ client?: string; template?: string }>;
}) {
  return <NewEngagementScreen {...props} />;
}
