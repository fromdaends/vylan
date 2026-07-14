import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import { listRequestItems, type RequestItem } from "@/lib/db/request-items";
import {
  listUploadedFilesForEngagement,
  signedDownloadUrls,
  type UploadedFile,
} from "@/lib/db/uploaded-files";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  sendEngagementAction,
  completeEngagementAction,
  reopenEngagementAction,
  sendReminderAction,
  deleteDraftAction,
} from "@/app/actions/engagements";
import {
  approveItemAction,
  reopenItemAction,
  removeItemAction,
} from "@/app/actions/items";
import { assertLocale } from "@/lib/locale";
import { formatDate, formatCurrency } from "@/lib/format";
import { EngagementTabs } from "@/components/engagements/engagement-tabs";
import { FilePreviewRow } from "@/components/engagements/file-preview-row";
import { ChecklistItemShell } from "@/components/engagements/checklist-item-shell";
import {
  SetSummaryLine,
  shouldShowSetLine,
  isMissingPageBlock,
} from "@/components/engagements/set-summary-line";
import { SetSummaryChatButton } from "@/components/assistant/set-summary-chat-button";
import { EngagementPreview } from "@/components/engagements/engagement-preview/engagement-preview";
import {
  QuickbooksDraftCard,
  type DraftCardOptions,
} from "@/components/engagements/quickbooks-draft-card";
import { QuickbooksDraftsSummary } from "@/components/engagements/quickbooks-drafts-summary";
import {
  getSuggestionsForEngagement,
  backfillMissingSuggestions,
  type StoredDraft,
} from "@/lib/db/quickbooks-suggestions";
import { getFirmQuickbooksStatus } from "@/lib/db/quickbooks";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import { readFirmLearnedMappings } from "@/lib/db/quickbooks-learned";
import type { LearnedMappings } from "@/lib/quickbooks/suggest";
import { isSelectableTaxCode } from "@/lib/quickbooks/tax-code";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { AssistantEngagementBridge } from "@/components/assistant/engagement-panel-bridge";
import { OpenAssistantActivityButton } from "@/components/assistant/open-assistant-activity-button";
import { AddItemDialog } from "@/components/engagements/add-item-dialog";
import { AddSignatureDialog } from "@/components/engagements/add-signature-dialog";
import { AddFinalDocumentDialog } from "@/components/engagements/add-final-document-dialog";
import { FinalDocumentRow } from "@/components/engagements/final-document-row";
import { listFinalDocumentsForEngagement } from "@/lib/db/final-documents";
import {
  CLIENT_MESSAGING_SCHEMA_MISSING,
  countUnreadForFirm,
  getThreadForEngagement,
  listClientMessages,
} from "@/lib/db/client-messages";
import { EngagementMessages } from "@/components/engagements/engagement-messages";
import { getServerSupabase } from "@/lib/supabase/server";
import { computeDeliverablesLocked } from "@/lib/portal/deliverable-access";
import { EngagementMoreMenu } from "@/components/engagements/engagement-header-actions";
import { EngagementAssignee } from "@/components/engagements/engagement-assignee";
import { AutoRefresh } from "@/components/engagements/auto-refresh";
import { DemoBlockButton } from "@/components/app/demo-block-modal";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getLatestPaymentRequestForEngagement,
  getLastFirmPaymentAmountCents,
} from "@/lib/db/payment-requests";
import { resolveDefaultAmountCents } from "@/lib/payments/prefill";
import { reconcilePaymentRequest } from "@/lib/payments/reconcile";
import {
  getSignatureRequestsByItem,
  type SignatureRequest,
} from "@/lib/db/signature-requests";
import { reconcileSignatureRequest } from "@/lib/signwell/reconcile";
import { signedUrl } from "@/lib/storage";
import { isTrialExpired } from "@/lib/trial";
import {
  getCurrentUser,
  listFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import { engagementToView } from "@/lib/navigation/active-nav";
import { viewHref, viewLabelKey } from "@/lib/engagements/views";
import {
  computeAttention,
  isReadyToReview,
  deriveEngagementStatus,
} from "@/lib/attention";
import { engagementStatusPillClass } from "@/lib/engagements/status-pill";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { hasActiveTeam } from "@/lib/team/mode";
import { SetEngagementDetailView } from "@/components/app/active-nav-context";
import {
  Send,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Bell,
  BellOff,
  Download,
  Sparkles,
  FileSignature,
  ExternalLink,
  Lock,
} from "lucide-react";

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Items / uploads all key off the URL `id` (= engagement.id), so they don't
  // need to wait for getEngagement — run the whole lot in ONE parallel batch.
  // The uploads branch also batch-signs every download URL in a single storage
  // round-trip (was N separate calls, the biggest chunk of this page's load).
  // Only the client lookup (needs engagement.client_id) waits. The Activity
  // feed no longer loads here — it lives in the Assistant panel's Activity
  // tab, which fetches it on demand via /api/engagement-chat/activity.
  const [engagement, items, uploadData, firm, user, firmUsers] =
    await Promise.all([
      getEngagement(id),
      listRequestItems(id),
      (async () => {
        const uploads = await listUploadedFilesForEngagement(id);
        const urlByPath = await signedDownloadUrls(
          uploads.map((u) => u.storage_path),
          900,
        );
        return { uploads, urlByPath };
      })(),
      getCurrentFirm(),
      getCurrentUser(),
      listFirmUsers(),
    ]);
  if (!engagement) notFound();
  const client = await getClient(engagement.client_id);
  const { uploads, urlByPath } = uploadData;
  // Send / reminder are locked only once the free trial has expired; an active
  // trial has full access.
  const trialLocked = firm ? isTrialExpired(firm) : false;
  // Delete (incl. delete-draft) is owner-only — hide both controls from staff.
  // The server actions enforce this too; this is the matching UI gate.
  const canDelete = user ? canDeleteEngagements(user.role) : false;

  // Payments (Phase 3): only relevant once the firm can actually receive money
  // (Stripe Connect ready). Load the latest request (status badge) + compute the
  // dialog's pre-fill amount (per-service default price -> last amount -> empty).
  const connectReady = firm?.connect_charges_enabled === true;
  const [latestPaymentRaw, lastFirmAmountCents] =
    connectReady && firm
      ? await Promise.all([
          getLatestPaymentRequestForEngagement(engagement.id),
          getLastFirmPaymentAmountCents(firm.id),
        ])
      : [null, null];
  // Self-heal: if a payment is still "requested" but Stripe already collected it
  // (the webhook can lag or be misconfigured), reconcile straight from Stripe so
  // the accountant sees "Paid" without depending on the webhook.
  let latestPayment = latestPaymentRaw;
  if (
    latestPaymentRaw &&
    latestPaymentRaw.status === "requested" &&
    firm?.stripe_connect_account_id
  ) {
    const status = await reconcilePaymentRequest(
      latestPaymentRaw.id,
      firm.stripe_connect_account_id,
    );
    if (status && status !== latestPaymentRaw.status) {
      latestPayment = { ...latestPaymentRaw, status };
    }
  }
  const paymentPrefillCents = resolveDefaultAmountCents(
    firm?.service_prices,
    engagement.type,
    lastFirmAmountCents,
  );
  const paymentPrefill =
    paymentPrefillCents != null ? (paymentPrefillCents / 100).toFixed(2) : "";
  // Whether the Final documents are locked, for the compact lock icon on the
  // header pill (same rule the portal + download route use).
  const deliverablesLocked = computeDeliverablesLocked({
    invoice: latestPayment,
    engagementLocksDeliverables: engagement.invoice_locks_deliverables === true,
  });

  // Assignment (Phase 5): resolve the assignee (may be deactivated — still shown
  // for history) + the active members available as reassignment targets.
  const assignee =
    firmUsers.find((u) => u.id === engagement.assigned_user_id) ?? null;
  const activeMembers = firmUsers
    .filter((u) => !u.deactivated_at)
    .map((u) => ({ id: u.id, name: userDisplayLabel(u) }));
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm?.team_enabled === true,
    activeMemberCount: activeMembers.length,
  });
  // Resolve a reviewer id -> display name for the QuickBooks draft cards
  // (who approved / dismissed). Includes deactivated members so history shows.
  const reviewerNameById = new Map<string, string>(
    firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
  );

  const filesByItem = new Map<string, (UploadedFile & { url: string })[]>();
  for (const u of uploads) {
    const arr = filesByItem.get(u.request_item_id) ?? [];
    arr.push({ ...u, url: urlByPath.get(u.storage_path) ?? "#" });
    filesByItem.set(u.request_item_id, arr);
  }

  // QuickBooks Stage 3 (Phase 3): the read-only DRAFT suggestion cards. Only
  // relevant when this firm has QuickBooks connected; the drafts themselves are
  // keyed by uploaded file. Both reads degrade gracefully (no connection / no
  // 0430 migration yet -> nothing shows).
  const quickbooksConnected = (await getFirmQuickbooksStatus()) != null;
  const [initialSuggestions, qboLists, qboLearned] = quickbooksConnected
    ? await Promise.all([
        getSuggestionsForEngagement(id),
        readCachedQuickbooksLists(),
        readFirmLearnedMappings(),
      ])
    : [new Map<string, StoredDraft>(), null, {} as LearnedMappings];
  let suggestionsByFile = initialSuggestions;
  // Self-heal: regenerate any draft that's missing but whose file already has a
  // stored transaction read (re-upload race / pre-migration classify / cleanup),
  // mirroring the payment + signature reconcile-on-load above. Cheap (no AI
  // call) and only re-reads when it actually created something.
  if (quickbooksConnected && qboLists) {
    const created = await backfillMissingSuggestions({
      firmId: engagement.firm_id,
      engagementId: id,
      files: uploads.map((u) => ({
        id: u.id,
        ai_extracted_fields: u.ai_extracted_fields,
      })),
      lists: qboLists,
      learned: qboLearned,
      existingFileIds: new Set(suggestionsByFile.keys()),
    });
    if (created > 0) suggestionsByFile = await getSuggestionsForEngagement(id);
  }
  // Only the drafts whose CARD is actually shown feed the engagement roll-up —
  // a draft's card appears once its document is approved (or it's posted), so
  // the summary's counts + "needs input" call-to-action must use the same gate,
  // or it would advertise work against cards the accountant can't see yet. Must
  // match the per-file footer gate in ItemRow below.
  const reviewStatusByFile = new Map(
    uploads.map((u) => [u.id, u.review_status]),
  );
  const visibleDrafts = [...suggestionsByFile.entries()]
    .filter(
      ([fid, d]) =>
        reviewStatusByFile.get(fid) === "approved" || d.status === "posted",
    )
    .map(([, d]) => d);

  // The cached QuickBooks lists the accountant picks from (active entries only).
  const toOpt = (x: { id: string; name: string }) => ({
    id: x.id,
    name: x.name,
  });
  const isPayFrom = (t: string | null) =>
    ["bank", "credit card"].includes((t ?? "").toLowerCase());
  const qboOptions: DraftCardOptions = {
    vendors: (qboLists?.vendors ?? []).filter((x) => x.active).map(toOpt),
    customers: (qboLists?.customers ?? []).filter((x) => x.active).map(toOpt),
    accounts: (qboLists?.accounts ?? []).filter((x) => x.active).map(toOpt),
    // Exclude QuickBooks "adjustment" tax codes: they have no purchase/sales rate
    // and QuickBooks rejects them on a transaction (tax-calc ValidationFault 6000).
    taxCodes: (qboLists?.taxCodes ?? [])
      .filter((x) => x.active && isSelectableTaxCode(x.name))
      .map(toOpt),
    items: (qboLists?.items ?? []).filter((x) => x.active).map(toOpt),
    paymentAccounts: (qboLists?.accounts ?? [])
      .filter((x) => x.active && isPayFrom(x.accountType))
      .map(toOpt),
  };

  // Prompt B: signature items (the accountant supplies a document, the client
  // returns a signed copy) render in their own "Signatures" group, separate
  // from the document-collection checklist.
  const signatureItems = items.filter((i) => i.kind === "signature");
  const collectionItems = items.filter((i) => i.kind !== "signature");

  // SignWell status per signature item (one query, RLS-scoped). Empty before
  // migration 0400 is applied or when there are no signature items.
  const signatureRequestsByItem =
    signatureItems.length > 0
      ? await getSignatureRequestsByItem(engagement.id)
      : new Map<string, SignatureRequest>();

  // Self-heal: the SignWell webhook can lag or be misconfigured, so for any
  // request still out for signature, reconcile straight from SignWell. If it's
  // signed, this pulls the signed PDF back and flips the status without waiting
  // on the webhook (mirrors the payments reconcile).
  const awaitingSigs = [...signatureRequestsByItem.values()].filter(
    (sr) => sr.status === "sent" || sr.status === "viewed",
  );
  if (awaitingSigs.length > 0) {
    const reconciled = await Promise.all(
      awaitingSigs.map((sr) => reconcileSignatureRequest(sr)),
    );
    const anyChanged = reconciled.some((s, i) => s !== awaitingSigs[i].status);
    if (anyChanged) {
      // One re-read to pick up the new status + signed_file_path on changed rows.
      const fresh = await getSignatureRequestsByItem(engagement.id);
      for (const [k, v] of fresh) signatureRequestsByItem.set(k, v);
    }
  }

  // Final documents (accountant deliverables) + their pre-signed download links.
  // The accountant download is always allowed — the invoice lock only ever gates
  // the CLIENT's portal download, never the firm. Empty before migration 0620.
  const finalDocs = await listFinalDocumentsForEngagement(engagement.id);
  const finalHrefById = new Map<string, string>();
  await Promise.all(
    finalDocs.map(async (d) => {
      try {
        finalHrefById.set(
          d.id,
          await signedUrl(d.storage_path, 3600, d.original_filename),
        );
      } catch {
        // Leave unset → the row disables its download link.
      }
    }),
  );

  // Client messaging (Phase 1): the human accountant<->client thread. Loads
  // under RLS; degrades to the gated "not activated" state before migration
  // 0650. Unread = client messages newer than the firm's read pointer.
  const supabaseForMessages = await getServerSupabase();
  const [clientMessagesRaw, messageThreadRaw] = await Promise.all([
    listClientMessages(supabaseForMessages, engagement.id),
    getThreadForEngagement(supabaseForMessages, engagement.id),
  ]);
  const messagingNotActivated =
    clientMessagesRaw === CLIENT_MESSAGING_SCHEMA_MISSING ||
    messageThreadRaw === CLIENT_MESSAGING_SCHEMA_MISSING;
  const clientMessages =
    clientMessagesRaw === CLIENT_MESSAGING_SCHEMA_MISSING
      ? []
      : clientMessagesRaw;
  const messageThread =
    messageThreadRaw === CLIENT_MESSAGING_SCHEMA_MISSING
      ? null
      : messageThreadRaw;
  const messagesUnread = countUnreadForFirm(
    clientMessages,
    messageThread?.firm_last_read_at ?? null,
  );

  const t = await getTranslations("Engagements");
  const paymentStatusLabel = latestPayment
    ? latestPayment.status === "paid"
      ? t("payment_status_paid")
      : latestPayment.status === "failed"
        ? t("payment_status_failed")
        : latestPayment.status === "canceled"
          ? t("payment_status_canceled")
          : t("payment_status_requested")
    : null;
  const tStatus = await getTranslations("Status");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  // Which All-Engagements sub-page this engagement belongs to — drives both the
  // sidebar highlight (via SetEngagementDetailView) and the breadcrumb. Derived
  // the same way the list pages categorize engagements (lifecycle predicates +
  // readyToReview), so the sidebar always agrees with the lists. The SAME
  // attention result also feeds the header's unified status pill, so the pill
  // and the sidebar bucket can never disagree.
  const attention = computeAttention({
    engagement,
    items,
    lastClientActivityAt: null,
  });
  const readyToReview = isReadyToReview(attention);
  const derivedStatus = deriveEngagementStatus(engagement.status, attention);
  const view = engagementToView(engagement, { readyToReview });

  // Client portal URL — used by the "Copy payment link" button when a payment is
  // requested. (The client-link copy in the header 3-dots menu builds its own
  // origin-aware URL from the magic token.)
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  const portalUrl =
    engagement.magic_token != null
      ? `${baseUrl}/r/${engagement.magic_token}`
      : null;

  const isLive =
    engagement.status === "sent" || engagement.status === "in_progress";
  const isDraft = engagement.status === "draft";
  const isComplete = engagement.status === "complete";

  return (
    <div className="space-y-6">
      {/* Publishes this engagement to the Assistant panel (mounted in the app
          layout) so the panel preselects it and can badge its button on fresh
          engagements. Renders nothing. */}
      <AssistantEngagementBridge
        engagement={{
          id: engagement.id,
          title: engagement.title,
          clientName: client?.display_name ?? null,
          status: engagement.status,
          createdAt: engagement.created_at,
        }}
      />
      {/* Auto-refresh while the engagement is still active. Picks up new
          client uploads + AI verdicts + activity-log entries without
          requiring the accountant to hit reload. Skipped for draft /
          complete / cancelled engagements since nothing changes there. */}
      {isLive && <AutoRefresh intervalMs={5000} />}

      {/* Publishes this engagement's view to the sidebar so the matching
          sub-page highlights. Renders nothing. */}
      <SetEngagementDetailView view={view} />

      {/* Orientation: Engagements › {sub-page} › {this engagement}. Replaces the
          old single "Back" link — the crumbs return to the right list. */}
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_engagements"), href: "/engagements" },
          { label: t(viewLabelKey(view)), href: viewHref(view) },
          { label: engagement.title },
        ]}
      />

      <header className="flex flex-wrap items-start justify-between gap-3 animate-in-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {engagement.title}
          </h1>
          <div className="flex items-center gap-2 mt-2.5 text-sm flex-wrap">
            <Badge
              variant={statusVariant(derivedStatus)}
              className={engagementStatusPillClass(derivedStatus)}
            >
              {tStatus(derivedStatus)}
            </Badge>
            {client && (
              <Link
                href={`/clients/${client.id}`}
                className="text-muted-foreground hover:text-foreground"
              >
                {client.display_name}
              </Link>
            )}
            {engagement.due_date && (
              <span className="text-muted-foreground">
                ·{" "}
                {t("due", {
                  date: formatDate(engagement.due_date, locale, "medium"),
                })}
              </span>
            )}
            {engagement.reminders_paused && (
              <Badge variant="outline" className="text-xs">
                <BellOff className="size-3" />
                {t("reminders_paused_badge")}
              </Badge>
            )}
            {/* AI was turned off for this engagement at creation — uploads are
                never sent to the AI, so the per-document AI verdicts below are
                hidden. Surfaced here so the accountant knows why. */}
            {engagement.ai_enabled === false && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                <Sparkles className="size-3" />
                {t("ai_off_badge")}
              </Badge>
            )}
          </div>
          {/* Assigned to — accountability control (reassign to any active member). */}
          {teamEnabled && (
            <div className="mt-3">
              <EngagementAssignee
                engagementId={engagement.id}
                assigneeId={engagement.assigned_user_id}
                assigneeName={assignee ? userDisplayLabel(assignee) : null}
                assigneeDeactivated={!!assignee?.deactivated_at}
                members={activeMembers}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && (
            <>
              {trialLocked ? (
                <DemoBlockButton
                  label={t("send")}
                  icon={<Send className="size-4" />}
                  reasonKey="block_send_engagement_reason"
                  size="sm"
                />
              ) : items.length === 0 ? (
                <Button
                  type="button"
                  size="sm"
                  disabled
                  title={t("send_no_items_hint")}
                >
                  <Send className="size-4" />
                  {t("send")}
                </Button>
              ) : (
                <form action={sendEngagementAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button type="submit" size="sm">
                    <Send className="size-4" />
                    {t("send")}
                  </Button>
                </form>
              )}
              {canDelete && (
                <form action={deleteDraftAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <input type="hidden" name="__app_locale" value={locale} />
                  <Button type="submit" variant="outline" size="sm">
                    <Trash2 className="size-4" />
                    {t("delete_draft")}
                  </Button>
                </form>
              )}
            </>
          )}
          {isLive && (
            <>
              {trialLocked ? (
                <DemoBlockButton
                  label={t("send_reminder")}
                  icon={<Bell className="size-4" />}
                  reasonKey="block_send_reminder_reason"
                  variant="outline"
                  size="sm"
                  className="group h-8 w-8 gap-0 overflow-hidden px-0 transition-[width,padding,gap] duration-200 hover:w-36 hover:gap-1.5 hover:px-3 focus-visible:w-36 focus-visible:gap-1.5 focus-visible:px-3"
                  labelClassName="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-32 group-hover:opacity-100 group-focus-visible:max-w-32 group-focus-visible:opacity-100"
                />
              ) : (
                <form action={sendReminderAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    aria-label={t("send_reminder")}
                    title={t("send_reminder")}
                    className="group h-8 w-8 gap-0 overflow-hidden px-0 transition-[width,padding,gap] duration-200 hover:w-36 hover:gap-1.5 hover:px-3 focus-visible:w-36 focus-visible:gap-1.5 focus-visible:px-3"
                  >
                    <Bell className="size-4" />
                    <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-32 group-hover:opacity-100 group-focus-visible:max-w-32 group-focus-visible:opacity-100">
                      {t("send_reminder")}
                    </span>
                  </Button>
                </form>
              )}
              {/* Mark complete — the clear primary action. Plain default
                  button hover (no green tint) per founder preference. */}
              <form action={completeEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button type="submit" size="sm">
                  <CheckCircle2 className="size-4" />
                  {t("mark_complete")}
                </Button>
              </form>
            </>
          )}
          {/* Compact invoice status pill (a lock icon when the Final documents
              are locked). All invoice actions now live in the "..." menu's
              Invoice option, to keep the header calm. */}
          {latestPayment && paymentStatusLabel && (
            <Badge
              variant={
                latestPayment.status === "paid"
                  ? "default"
                  : latestPayment.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className="gap-1"
            >
              {deliverablesLocked && (
                <Lock className="size-3" aria-hidden />
              )}
              {paymentStatusLabel} ·{" "}
              {formatCurrency(latestPayment.amount_cents / 100, locale)}
            </Badge>
          )}
          {isComplete && (
            <>
              <form action={reopenEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button type="submit" variant="outline" size="sm">
                  <RotateCcw className="size-4" />
                  {t("reopen")}
                </Button>
              </form>
            </>
          )}
          {/* Activity: drafts keep a standalone icon; every other state opens
              it from the "..." menu, so the row stays calm. Both now open the
              Assistant panel's Activity tab (the panel absorbed the old
              slide-out feed). */}
          {isDraft && <OpenAssistantActivityButton />}
          {/* The "..." menu holds the occasional actions — Activity, Copy client
              / payment link, Pause/Resume reminders, Download all, Cancel,
              Delete — so only primary buttons + the payment pill stay in the
              row. Delete keeps its confirmation + 30-day recovery. Drafts keep
              their own inline Send + Delete-draft buttons and never get it. */}
          {!isDraft && (
            <EngagementMoreMenu
              engagementId={engagement.id}
              locale={locale}
              status={isLive ? "live" : isComplete ? "complete" : "cancelled"}
              remindersPaused={engagement.reminders_paused}
              hasUploads={uploads.length > 0}
              canDelete={canDelete}
              clientLinkToken={
                isLive ? (engagement.magic_token ?? undefined) : undefined
              }
              paymentLinkUrl={
                latestPayment?.status === "requested"
                  ? (portalUrl ?? undefined)
                  : undefined
              }
              connectReady={connectReady}
              invoice={
                latestPayment
                  ? {
                      id: latestPayment.id,
                      status: latestPayment.status,
                      amount_cents: latestPayment.amount_cents,
                      description: latestPayment.description,
                      locks_deliverables: latestPayment.locks_deliverables,
                      override_unlocked: latestPayment.override_unlocked,
                    }
                  : null
              }
              engagementLocksDeliverables={
                engagement.invoice_locks_deliverables === true
              }
              invoiceDefaultAmount={paymentPrefill}
            />
          )}
        </div>
      </header>

      {isDraft &&
        (items.length === 0 ? (
          <Alert variant="destructive">
            <AlertDescription>{t("send_no_items_blocked")}</AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertDescription>{t("draft_notice")}</AlertDescription>
          </Alert>
        ))}

      {/* Checklist + Signatures share one tab switch (Checklist is the default)
          so the page shows one section at a time instead of stacking both. Each
          tab keeps its own controls. The Activity feed lives in the Assistant
          panel's Activity tab, opened from the header. */}
      <EngagementTabs
        checklistCount={collectionItems.length}
        signaturesCount={signatureItems.length}
        showSignatures={isLive || signatureItems.length > 0}
        checklistControls={
          <>
            {/* Always-available visual review of every uploaded document. */}
            <EngagementPreview
              uploads={uploads}
              items={items}
              engagementId={engagement.id}
              engagementTitle={engagement.title}
              clientName={client?.display_name ?? null}
              locale={locale}
            />
            {isLive && (
              <AddItemDialog
                engagementId={engagement.id}
                province={client?.province ?? null}
              />
            )}
          </>
        }
        signaturesControls={
          isLive ? <AddSignatureDialog engagementId={engagement.id} /> : null
        }
        checklist={
          collectionItems.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("checklist_empty")}
            </div>
          ) : (
            <>
              {/* QuickBooks Stage 3: roll-up of the drafts on this engagement
                  (renders nothing when there are none / AI is off). */}
              {engagement.ai_enabled !== false && (
                <QuickbooksDraftsSummary
                  drafts={visibleDrafts}
                  locale={locale}
                />
              )}
              <ul className="space-y-2">
                {collectionItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    files={filesByItem.get(item.id) ?? []}
                    suggestionsByFile={suggestionsByFile}
                    qboOptions={qboOptions}
                    reviewerNameById={reviewerNameById}
                    locale={locale}
                    canEdit={isLive}
                    clientName={client?.display_name ?? null}
                    expectedYear={expectedYearFromTitle(engagement.title)}
                    // AI off for this engagement → hide the per-document AI
                    // verdicts (they'd otherwise sit on a permanent "Not
                    // analyzed" chip). `=== false` so pre-migration (undefined)
                    // keeps AI shown.
                    aiEnabled={engagement.ai_enabled !== false}
                  />
                ))}
              </ul>
            </>
          )
        }
        signatures={
          signatureItems.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("signatures_empty")}
            </div>
          ) : (
            <ul className="space-y-3">
              {signatureItems.map((item) => (
                <SignatureRow
                  key={item.id}
                  item={item}
                  locale={locale}
                  canEdit={isLive}
                  signatureRequest={
                    signatureRequestsByItem.get(item.id) ?? null
                  }
                />
              ))}
            </ul>
          )
        }
        finalCount={finalDocs.length}
        showFinal={isLive || isComplete || finalDocs.length > 0}
        messagesCount={clientMessages.length}
        messagesUnread={messagesUnread}
        // Live + complete engagements get the thread (complete = read-only
        // history); drafts have no client link yet; cancelled only shows if
        // history exists. Hidden entirely pre-migration (quiet gating).
        showMessages={
          !messagingNotActivated &&
          (isLive || isComplete || clientMessages.length > 0)
        }
        messages={
          <EngagementMessages
            engagementId={engagement.id}
            clientName={client?.display_name ?? null}
            initialMessages={clientMessages}
            notActivated={messagingNotActivated}
            readOnly={!isLive}
            readOnlyReason={
              engagement.status === "cancelled"
                ? "cancelled"
                : isComplete
                  ? "complete"
                  : null
            }
            locale={locale}
          />
        }
        finalControls={
          engagement.status !== "cancelled" ? (
            <AddFinalDocumentDialog engagementId={engagement.id} />
          ) : null
        }
        final={
          finalDocs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("final_empty")}
            </div>
          ) : (
            <ul className="space-y-2">
              {finalDocs.map((d) => (
                <FinalDocumentRow
                  key={d.id}
                  id={d.id}
                  engagementId={engagement.id}
                  filename={d.display_name || d.original_filename}
                  note={d.note}
                  downloadHref={finalHrefById.get(d.id) ?? null}
                  canEdit={engagement.status !== "cancelled"}
                />
              ))}
            </ul>
          )
        }
      />
    </div>
  );
}

async function ItemRow({
  item,
  files,
  suggestionsByFile,
  qboOptions,
  reviewerNameById,
  locale,
  canEdit,
  clientName,
  expectedYear,
  aiEnabled,
}: {
  item: RequestItem;
  files: (UploadedFile & { url: string })[];
  // QuickBooks drafts keyed by uploaded file id (empty when QB isn't connected or
  // the migration isn't applied).
  suggestionsByFile: Map<string, StoredDraft>;
  // The cached QuickBooks lists the draft cells pick from.
  qboOptions: DraftCardOptions;
  // Reviewer id -> display name, for the draft card's "approved/dismissed by" line.
  reviewerNameById: Map<string, string>;
  locale: "fr" | "en";
  canEdit: boolean;
  clientName: string | null;
  expectedYear: number | null;
  // When false, AI is off for this engagement — hide all per-document AI chrome.
  aiEnabled: boolean;
}) {
  const t = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const label = locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const hasSubmittedFiles = files.length > 0;
  const hasReason = item.status === "rejected" && !!item.rejection_reason;
  // A missing-page block reads as "rejected" in the roll-up but isn't a file
  // rejection — relabel the badge and offer approve/reject instead of reopen.
  const missingPageBlock = isMissingPageBlock(item);
  // Collapsible only when there's something to reveal. Items needing the
  // accountant's eye (submitted = awaiting review, rejected = shows the reason)
  // start open; resolved/empty items start collapsed so a long list stays calm.
  const hasBody = hasSubmittedFiles || hasReason;
  const defaultOpen = item.status === "submitted" || item.status === "rejected";

  const summary = (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{label}</div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {item.doc_type}
            {item.required && (
              <span className="ml-2 text-warning">· {t("required")}</span>
            )}
          </div>
          {aiEnabled &&
            shouldShowSetLine(item.ai_set_assessment, files.length) && (
              <div className="mt-1.5 flex items-start gap-1">
                <SetSummaryLine
                  assessment={item.ai_set_assessment}
                  locale={locale}
                />
                {/* Open the full summary in the engagement chat (accountant
                    only — the client Preview renders SetSummaryLine alone). */}
                <SetSummaryChatButton
                  engagementId={item.engagement_id}
                  itemId={item.id}
                />
              </div>
            )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {missingPageBlock ? (
            <Badge variant="outline" className="border-warning/40 text-warning">
              {t("set_incomplete_badge")}
            </Badge>
          ) : item.status === "rejected" ? (
            // A document under this item was sent back — the line isn't
            // "rejected/closed", it's waiting on the client to resend. Soft
            // amber, not a hard red "Rejected".
            <Badge variant="outline" className="border-warning/40 text-warning">
              {t("awaiting_client_badge")}
            </Badge>
          ) : (
            <Badge variant={itemBadgeVariant(item.status)}>
              {tStatus(item.status)}
            </Badge>
          )}
          {/* Approve the whole checklist line. Rejection is per-DOCUMENT (the
              icon on each file row below), so there is no item-level reject. */}
          {(item.status === "submitted" || missingPageBlock) && canEdit && (
            <form action={approveItemAction}>
              <input type="hidden" name="id" value={item.id} />
              {/* Plain default button hover (no green tint) per founder
                  preference. */}
              <Button type="submit" size="sm">
                <CheckCircle2 className="size-4" />
                {t("approve")}
              </Button>
            </form>
          )}
          {/* Reopen undoes an approval, OR clears a per-document rejection, back
              to in-review. Approved items were previously stuck with no way to
              reopen — this closes that gap. */}
          {(item.status === "approved" ||
            (item.status === "rejected" && !missingPageBlock)) &&
            canEdit && (
              <form action={reopenItemAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button type="submit" variant="outline" size="sm">
                  <RotateCcw className="size-4" />
                  {t("reopen_item")}
                </Button>
              </form>
            )}
          {canEdit &&
            !hasSubmittedFiles &&
            (item.status === "pending" || item.status === "na") && (
              <form action={removeItemAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("remove_item")}
                  title={t("remove_item")}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </form>
            )}
        </div>
      </div>
    </>
  );

  return (
    <ChecklistItemShell
      defaultOpen={defaultOpen}
      collapsible={hasBody}
      summary={summary}
    >
      {hasReason && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            <span className="font-medium">{t("rejection_reason")}: </span>
            {item.rejection_reason}
          </AlertDescription>
        </Alert>
      )}
      {hasSubmittedFiles && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <FilePreviewRow
              key={f.id}
              file={f}
              url={f.url}
              expectedDocType={item.doc_type}
              expectedYear={expectedYear}
              clientName={clientName}
              rejectionCount={item.ai_rejection_count ?? 0}
              // AI off for this engagement → no AI chrome on the row.
              hideAi={!aiEnabled}
              // Per-document reject (the founder's model: approve the line as a
              // whole, send back individual documents). A set-aside duplicate
              // can't be rejected — it already doesn't count. Once a document IS
              // rejected it's done: the X is replaced by an Undo (reopen) so it
              // never prompts a pointless second reject.
              reviewAction={
                canEdit && !f.is_duplicate
                  ? f.review_status === "rejected"
                    ? { kind: "reopen" as const, fileId: f.id }
                    : {
                        kind: "reject" as const,
                        itemId: item.id,
                        itemLabel: f.display_name ?? f.original_filename,
                        fileId: f.id,
                      }
                  : undefined
              }
              // QuickBooks draft: the suggested mapping for a receipt/invoice.
              // Shown only when AI is on, a draft exists (which implies
              // QuickBooks is connected), AND the accountant has APPROVED the
              // document — bookkeeping is the step AFTER accepting the collected
              // doc, so the card stays out of the way until then. Always kept
              // visible once posted, so a live transaction never disappears.
              footer={(() => {
                const d = aiEnabled ? suggestionsByFile.get(f.id) : undefined;
                if (
                  !d ||
                  (f.review_status !== "approved" && d.status !== "posted")
                ) {
                  return undefined;
                }
                return (
                  <QuickbooksDraftCard
                    suggestion={d.suggestion}
                    resolved={d.resolved}
                    options={qboOptions}
                    locale={locale}
                    fileId={f.id}
                    status={d.status}
                    reviewedByName={
                      d.reviewedBy
                        ? (reviewerNameById.get(d.reviewedBy) ?? null)
                        : null
                    }
                    reviewedAt={d.reviewedAt}
                    documentName={f.display_name ?? f.original_filename}
                    postedAt={d.postedAt}
                    postedByName={
                      d.postedBy
                        ? (reviewerNameById.get(d.postedBy) ?? null)
                        : null
                    }
                    postError={d.postError}
                    postedTaxNote={d.postedTaxNote}
                    receiptAttachedAt={d.receiptAttachedAt}
                    matchedQboType={d.matchedQboType}
                  />
                );
              })()}
            />
          ))}
        </ul>
      )}
    </ChecklistItemShell>
  );
}

// A signature item rendered for the accountant.
//
// Status is driven by the SignWell signature request (Phase 2): "Awaiting
// signature" once the embedded request is created, "Signing setup needed" when
// it could not be created (e.g. before the SignWell key is set), and "Signed"
// once completed (Phase 4). A "Test mode" chip shows while requests are
// watermarked. Embedded signing itself lands in the client portal (Phase 3).
async function SignatureRow({
  item,
  locale,
  canEdit,
  signatureRequest,
}: {
  item: RequestItem;
  locale: "fr" | "en";
  canEdit: boolean;
  signatureRequest: SignatureRequest | null;
}) {
  const t = await getTranslations("Engagements");
  const label = locale === "fr" && item.label_fr ? item.label_fr : item.label;

  const srStatus = signatureRequest?.status ?? null;
  const isSigned = srStatus === "completed" || item.status === "approved";
  const isAwaiting = srStatus === "sent" || srStatus === "viewed";
  const statusKey = isSigned
    ? "sig_status_signed"
    : isAwaiting
      ? "sig_status_awaiting"
      : "sig_status_setup_needed";
  const showTestChip =
    (isAwaiting || isSigned) && signatureRequest?.test_mode === true;

  // Status-badge tint by state (green when signed, amber while awaiting, neutral
  // when not set up). The card outline itself stays a plain neutral border in
  // every state.
  const badgeCls = isSigned
    ? "border-success/40 text-success"
    : isAwaiting
      ? "border-warning/40 text-warning"
      : "border-border text-muted-foreground";

  // Two short-lived links to the completed PDF (with SignWell's audit page): one
  // that RENDERS inline — the "View" opens the signed PDF on its own browser tab,
  // the browser's native PDF view, not a Vylan page — and one that forces a
  // download with a readable filename. Named to avoid the module-level `viewHref`.
  let viewSignedHref: string | null = null;
  let downloadSignedHref: string | null = null;
  if (isSigned && signatureRequest?.signed_file_path) {
    try {
      viewSignedHref = await signedUrl(signatureRequest.signed_file_path, 3600);
      downloadSignedHref = await signedUrl(
        signatureRequest.signed_file_path,
        3600,
        `${label}.pdf`,
      );
    } catch {
      viewSignedHref = null;
      downloadSignedHref = null;
    }
  }

  const showFooter = (isSigned && viewSignedHref) || (canEdit && !isSigned);

  return (
    <li>
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <FileSignature className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-wide leading-none text-muted-foreground">
              {t("sig_kicker")}
            </div>
            <div className="mt-1 truncate text-base font-semibold leading-none">
              {label}
            </div>
            {showTestChip && (
              <div className="mt-1.5">
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("sig_test_mode")}
                </span>
              </div>
            )}
          </div>
          <Badge variant="outline" className={`shrink-0 ${badgeCls}`}>
            {t(statusKey)}
          </Badge>
        </div>

        {showFooter && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 px-4 py-2.5">
            {isSigned && viewSignedHref && (
              <a
                href={viewSignedHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/80"
              >
                <ExternalLink className="size-3.5" />
                {t("sig_view_signed")}
              </a>
            )}
            {isSigned && downloadSignedHref && (
              <a
                href={downloadSignedHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Download className="size-3.5" />
                {t("sig_download_signed")}
              </a>
            )}
            {canEdit && !isSigned && (
              <form action={removeItemAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("remove_item")}
                  title={t("remove_item")}
                >
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete" || status === "approved") return "default";
  if (status === "cancelled" || status === "rejected") return "destructive";
  if (status === "draft" || status === "na") return "outline";
  return "secondary";
}

function itemBadgeVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  if (status === "na") return "outline";
  if (status === "submitted") return "secondary";
  return "outline";
}
