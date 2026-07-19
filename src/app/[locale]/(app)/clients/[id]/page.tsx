import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getClient } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { loadEngagementSignals } from "@/lib/dashboard/worklist";
import { deriveEngagementStatus } from "@/lib/attention";
import {
  engagementStatusPillClass,
  engagementStatusVariant,
} from "@/lib/engagements/status-pill";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { hasActiveTeam } from "@/lib/team/mode";
import { ClientAssignee } from "@/components/clients/client-assignee";
import {
  getLatestPaymentStatusByEngagementIds,
  listFirmPaymentsWithNames,
} from "@/lib/db/payment-requests";
import { reconcilePaymentRequest } from "@/lib/payments/reconcile";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/payments/payment-badge";
import { PaymentsList } from "@/components/payments/payments-list";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
import { Plus, FileText } from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { getClientQuickbooksStatus } from "@/lib/db/quickbooks";
import { getQuickbooksConnectionHealth } from "@/lib/quickbooks/connection";
import {
  isQuickbooksConfigured,
  quickbooksEnvironment,
} from "@/lib/quickbooks/client";
import { ClientQuickbooksCard } from "@/components/clients/client-quickbooks-card";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ qbo?: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const { qbo: qboParam } = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const client = await getClient(id);
  if (!client) notFound();

  const engagements = await listEngagements({ client_id: id });
  // Unified status for the pills below — same derivation every other surface
  // reads, via the cached active-scope signal load.
  const signals = await loadEngagementSignals("active");
  const derivedStatusById = new Map(
    signals.map((s) => [
      s.engagement.id,
      deriveEngagementStatus(s.engagement.status, s.attention),
    ]),
  );
  // Self-heal: re-check this client's still-"requested" payments against Stripe
  // (webhook-independent) so Paid shows even if the webhook never delivered, then
  // read the now-correct statuses for display. Bounded to one client's payments.
  const firm = await getCurrentFirm();
  // Team roster for the owner picker. Include deactivated members so a
  // former owner's name still renders (with a "please reassign" nudge);
  // only ACTIVE members are valid reassignment targets.
  const [firmUsers, me] = await Promise.all([
    listFirmUsers(),
    getCurrentUser(),
  ]);
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm?.team_enabled === true,
    activeMemberCount: firmUsers.filter((u) => !u.deactivated_at).length,
  });
  const owner =
    firmUsers.find((u) => u.id === client.assigned_user_id) ?? null;
  const assignableMembers = firmUsers
    .filter((u) => !u.deactivated_at)
    .map((u) => ({ id: u.id, name: userDisplayLabel(u) }));
  const connectedAccountId = firm?.stripe_connect_account_id ?? null;
  if (connectedAccountId) {
    const pending = await listFirmPaymentsWithNames({ clientId: id });
    await Promise.all(
      pending
        .filter((p) => p.status === "requested")
        .map((p) => reconcilePaymentRequest(p.id, connectedAccountId)),
    );
  }
  // Payment status per engagement (for the chip) + this client's payment history
  // (so the accountant can backtrack what was paid on which engagement).
  const [paymentByEng, clientPayments] = await Promise.all([
    getLatestPaymentStatusByEngagementIds(engagements.map((e) => e.id)),
    listFirmPaymentsWithNames({ clientId: id }),
  ]);
  const t = await getTranslations("Clients");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  // Per-client QuickBooks connection status for the card below. Mirrors how
  // Settings assembles the firm-level status: base status + a health check (which
  // detects a dead/revoked connection) + the platform-configured flag + the OAuth
  // callback result from ?qbo=. Connect/disconnect inside the card are owner-only.
  const qboStatus = await getClientQuickbooksStatus(client.id);
  const qboHealth =
    firm && qboStatus?.connected
      ? await getQuickbooksConnectionHealth(firm.id, client.id)
      : "ok";
  const qboCallbackStatus =
    qboParam === "done" ||
    qboParam === "denied" ||
    qboParam === "error" ||
    qboParam === "setup" ||
    qboParam === "enc"
      ? (qboParam as "done" | "denied" | "error" | "setup" | "enc")
      : null;
  const clientQuickbooks = {
    configured: isQuickbooksConfigured(),
    connected: Boolean(qboStatus?.connected),
    needsReconnect: qboHealth === "reconnect_required",
    companyName: qboStatus?.companyName ?? null,
    environment: qboStatus?.environment ?? quickbooksEnvironment(),
    callbackStatus: qboCallbackStatus,
  };
  const isOwner = me?.role === "owner";

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_clients"), href: "/clients" },
          { label: client.display_name },
        ]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.display_name}
          </h1>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Badge variant="secondary">
              {client.type === "individual"
                ? t("type_individual")
                : t("type_business")}
            </Badge>
            {client.archived_at ? (
              <Badge variant="outline">{t("archived")}</Badge>
            ) : (
              <Badge>{t("active")}</Badge>
            )}
            <span className="text-muted-foreground font-mono text-xs">
              {client.locale.toUpperCase()}
            </span>
          </div>
          {teamEnabled && (
            <div className="mt-3">
              <ClientAssignee
                clientId={client.id}
                assigneeId={client.assigned_user_id}
                assigneeName={owner ? userDisplayLabel(owner) : null}
                assigneeDeactivated={!!owner?.deactivated_at}
                members={assignableMembers}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/clients/${client.id}/archive`}>
            <Button variant="outline" size="sm">
              <FileText className="size-4" />
              {t("document_archive")}
            </Button>
          </Link>
          <ClientFormDialog mode="edit" locale={locale} client={client} />
          {client.archived_at ? (
            <form action={restoreClientAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("restore")}
              </Button>
            </form>
          ) : (
            <form action={archiveClientAction}>
              <input type="hidden" name="id" value={client.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("archive")}
              </Button>
            </form>
          )}
        </div>
      </header>

      <div className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {t("contact_info")}
        </h2>
        {/* Read-only by default. Every field renders as a labeled value,
            never an open input box — editing happens deliberately through
            the "Edit client" dialog in the header. This protects the email
            in particular, since it's where document-request links and
            reminders get sent. */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 text-sm">
          <DetailRow label={t("col_email")} value={client.email} />
          <DetailRow label={t("col_phone")} value={client.phone} mono />
          <DetailRow
            label={t("field_external_ref")}
            value={client.external_ref}
            mono
          />
          <DetailRow label={t("field_notes")} value={client.notes} wide />
        </dl>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {t("qbo_section_title")}
        </h2>
        <ClientQuickbooksCard
          clientId={client.id}
          clientName={client.display_name}
          status={clientQuickbooks}
          isOwner={isOwner}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-row items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {t("engagements")}{" "}
            <span className="text-muted-foreground font-normal">
              ({engagements.length})
            </span>
          </h2>
          {!client.archived_at && (
            <Link href={`/engagements/new?client=${client.id}`}>
              <Button size="sm">
                <Plus className="size-4" />
                {tEng("new")}
              </Button>
            </Link>
          )}
        </div>
          {engagements.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("engagements_empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {engagements.map((e) => (
                <li key={e.id} className="py-3">
                  <Link
                    href={`/engagements/${e.id}`}
                    className="flex items-center justify-between gap-3 hover:text-foreground"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {e.type.toUpperCase()}
                        {e.due_date && ` · ${formatDate(e.due_date, locale, "medium")}`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {paymentByEng.get(e.id) &&
                        paymentByEng.get(e.id)!.status !== "canceled" && (
                          <PaymentBadge status={paymentByEng.get(e.id)!.status} />
                        )}
                      <Badge
                        variant={engagementStatusVariant(
                          derivedStatusById.get(e.id) ?? e.status,
                        )}
                        className={engagementStatusPillClass(
                          derivedStatusById.get(e.id) ?? e.status,
                        )}
                      >
                        {tStatus(derivedStatusById.get(e.id) ?? e.status)}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </div>

      {clientPayments.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {tEng("payments_history")}
          </h2>
          <PaymentsList
            rows={clientPayments}
            showClient={false}
            currentUserId={me?.id}
          />
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd
        className={
          (mono ? "font-mono " : "") +
          (value ? "" : "text-muted-foreground/60") +
          " mt-0.5 whitespace-pre-wrap"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

