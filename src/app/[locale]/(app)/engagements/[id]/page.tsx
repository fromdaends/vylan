import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import {
  listRelationshipsForClient,
  listRelatedClientsBrief,
} from "@/lib/db/relationships";
import { findScopeWarning } from "@/lib/relationships/validate";
import { listRequestItems, type RequestItem } from "@/lib/db/request-items";
import {
  listUploadedFilesForEngagement,
  type UploadedFile,
} from "@/lib/db/uploaded-files";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  sendEngagementAction,
  completeEngagementAction,
  acceptOnBehalfAction,
  activateEngagementAction,
  revertEngagementToDraftAction,
  reopenEngagementAction,
  deleteDraftAction,
} from "@/app/actions/engagements";
import {
  approveItemAction,
  reopenItemAction,
  removeItemAction,
} from "@/app/actions/items";
import { assertLocale } from "@/lib/locale";
import { formatDate, formatCurrency } from "@/lib/format";
import { listEngagementItems } from "@/lib/db/engagements";
import { listBillingSchedulesForEngagement } from "@/lib/db/billing-schedules";
import { EngagementServicesPanel } from "@/components/engagements/engagement-services-panel";
import { EngagementClientViewPanel } from "@/components/engagements/engagement-client-view-panel";
import { EngagementDetailsCard } from "@/components/engagements/engagement-details-card";
import { AgreementChip } from "@/components/engagements/agreement-chip";
import { EngagementTabs } from "@/components/engagements/engagement-tabs";
import { WorkflowGateCard } from "@/components/engagements/workflow-gate-card";
import { getPendingWorkflowGate } from "@/lib/engagements/stage-sync";
import { getServerSupabase } from "@/lib/supabase/server";
import { FilePreviewRow } from "@/components/engagements/file-preview-row";
import { CommentThread } from "@/components/engagements/comment-thread";
// The key builders MUST come from the plain comment-keys module, NOT from
// comment-thread ("use client"): this page is a Server Component and CALLS
// them — through the client module they'd be client references, and calling
// one on the server 500s the whole page at request time (invisible to tsc
// and next build; the repo's known RSC function-prop class, cf. #796).
import {
  commentKeyForItem,
  commentKeyForEngagement,
} from "@/components/engagements/comment-keys";
import { OpenCommentComposerOnLoad } from "@/components/engagements/open-comment-composer-on-load";
import {
  listCommentsForEngagement,
  groupEngagementComments,
  type FileComment,
} from "@/lib/db/file-comments";
import { ChecklistItemShell } from "@/components/engagements/checklist-item-shell";
import {
  SetSummaryLine,
  shouldShowSetLine,
  isMissingPageBlock,
} from "@/components/engagements/set-summary-line";
import { EngagementPreview } from "@/components/engagements/engagement-preview/engagement-preview";
import {
  QuickbooksDraftCard,
  type DraftCardOptions,
} from "@/components/engagements/quickbooks-draft-card";
import {
  PayoutBreakdownCard,
  payoutCardData,
} from "@/components/engagements/payout-breakdown-card";
import {
  PayoutJournalSection,
  PayoutJournalUnavailable,
} from "@/components/engagements/payout-journal-section";
import {
  ensurePayoutJournalDraft,
  getPayoutJournalsForEngagement,
  type PayoutJournalDraft,
} from "@/lib/db/payout-journal";
import type { TypedAccount } from "@/lib/quickbooks/journal-accounts";
import { QuickbooksDraftsSummary } from "@/components/engagements/quickbooks-drafts-summary";
import {
  getSuggestionsForEngagement,
  backfillMissingSuggestions,
  type StoredDraft,
} from "@/lib/db/quickbooks-suggestions";
import { getClientQuickbooksStatus } from "@/lib/db/quickbooks";
import { getClientXeroStatus,
  readClientXeroBaseCurrency,
} from "@/lib/db/xero";
import { readCachedQuickbooksLists } from "@/lib/db/quickbooks-cache";
import {
  readCachedXeroLists,
  readCachedXeroTracking,
} from "@/lib/db/xero-cache";
import { readFirmLearnedMappings } from "@/lib/db/quickbooks-learned";
import type { LearnedMappings } from "@/lib/quickbooks/suggest";
import { isSelectableTaxCode } from "@/lib/quickbooks/tax-code";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { OpenPanelOnLoad } from "@/components/assistant/open-panel-on-load";
import { InvoiceOptionsDialog } from "@/components/engagements/invoice-options-dialog";
import { AddItemDialog } from "@/components/engagements/add-item-dialog";
import { AddSignatureDialog } from "@/components/engagements/add-signature-dialog";
import { ResumeSignaturePlacement } from "@/components/engagements/resume-signature-placement";
import { RetrySignatureSetup } from "@/components/engagements/retry-signature-setup";
import { AddFinalDocumentDialog } from "@/components/engagements/add-final-document-dialog";
import { FinalDocumentRow } from "@/components/engagements/final-document-row";
import { listFinalDocumentsForEngagement } from "@/lib/db/final-documents";
import { computeDeliverablesLocked } from "@/lib/portal/deliverable-access";
import { EngagementMoreMenu } from "@/components/engagements/engagement-header-actions";
import { SendReminderButton } from "@/components/engagements/send-reminder-button";
import { getRecurringSeries } from "@/lib/db/recurring";
import { RecurringBadge } from "@/components/engagements/recurring-badge";
import {
  deriveInvoiceSnapshotFromEngagement,
  parseInvoiceSnapshot,
} from "@/lib/recurring/invoice-snapshot";
import { engagementMatchesSeries } from "@/lib/recurring/sync";
import { snapshotFromRequestItems } from "@/lib/recurring/snapshot";
import { SeriesSyncPrompt } from "@/components/engagements/series-sync-prompt";
import { EngagementAssignee } from "@/components/engagements/engagement-assignee";
import { EngagementAssigneesControl } from "@/components/engagements/engagement-assignees-control";
import {
  listEngagementAssignees,
  resolveAssignees,
} from "@/lib/db/engagement-assignees";
import { EngagementAccess } from "@/components/engagements/engagement-access";
import { AddTaskDialog } from "@/components/engagements/add-task-dialog";
import { EngagementPresence } from "@/components/engagements/engagement-presence";
import { getLatestHandoffNote } from "@/lib/db/activity";
import {
  getRecentInvoiceCancel,
} from "@/lib/db/activity";
import { PaymentCanceledChip } from "@/components/engagements/payment-canceled-chip";
// From a neutral module, never from the "use client" chip: a value imported
// from a client module reaches this Server Component as a stub, which silently
// made the "is the cancel recent?" comparison always false.
import { PAYMENT_CANCELED_CHIP_WINDOW_MS } from "@/lib/payments/canceled-chip";
import { AutoRefresh } from "@/components/engagements/auto-refresh";
import { DemoBlockButton } from "@/components/app/demo-block-modal";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  getLatestPaymentRequestForEngagement,
  getLastFirmPaymentAmountCents,
  type PaymentRequest,
} from "@/lib/db/payment-requests";
import { resolveDefaultAmountCents } from "@/lib/payments/prefill";
import { getFirmInvoiceSettings } from "@/lib/db/invoice-settings";
import { reconcilePaymentRequest } from "@/lib/payments/reconcile";
import { reconcilePayPalOrder } from "@/lib/payments/paypal-reconcile";
import { shouldReconcile } from "@/lib/reconcile-throttle";
import { firmPaymentRails } from "@/lib/payments/rails";
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
import { can } from "@/lib/auth/capabilities";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { listEntriesForEngagement } from "@/lib/db/time-entries";
import { dateInTimeZone } from "@/lib/tasks/dates";
import { TimePanel } from "@/components/time/time-panel";
import { engagementToView } from "@/lib/navigation/active-nav";
import { viewHref, viewLabelKey } from "@/lib/engagements/views";
import { normalizeReminderSettings } from "@/lib/reminder-settings";
import {
  computeAttention,
  isReadyToReview,
  deriveEngagementStatus,
} from "@/lib/attention";
import { engagementStatusPillClass } from "@/lib/engagements/status-pill";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { AgreementStepper } from "@/components/engagements/agreement-stepper";
import { resolveAgreementStatus } from "@/lib/engagements/agreement";
import { BackLink } from "@/components/ui/back-link";
import { hasActiveTeam } from "@/lib/team/mode";
import { listClientMembers } from "@/lib/db/client-members";
import { listEngagementMembers } from "@/lib/db/engagement-members";
import { listTaskStatuses } from "@/lib/db/task-statuses";
import { listSubtasksByParent, listEngagementTasks } from "@/lib/db/engagement-tasks";
import { SetEngagementDetailView } from "@/components/app/active-nav-context";
import {
  Send,
  Trash2,
  CheckCircle2,
  RotateCcw,
  BellRing,
  BellOff,
  Download,
  Sparkles,
  FileSignature,
  ExternalLink,
  Lock,
  ChevronRight,
  Link2,
  AlertTriangle,
} from "lucide-react";

export default async function EngagementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams?: Promise<{ panel?: string; comment?: string; task?: string }>;
  // ?panel=invoice is Billing → New invoice landing here: the invoice flow
  // lives on this page and nowhere else, so that button picks an engagement
  // and links in rather than mounting a second copy of the builder.
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = (await searchParams) ?? {};

  // Items / uploads all key off the URL `id` (= engagement.id), so they don't
  // need to wait for getEngagement — run the whole lot in ONE parallel batch.
  // Only things needing engagement/firm fields wait, and those all go in one
  // SECOND batch below. There is no Activity feed on this page at all any
  // more: history is owner-only and lives at /settings/audit, filterable by
  // client or by person. The Assistant panel's Activity tab and its
  // /api/engagement-chat/activity route are gone too — they had been dead for
  // a while before anyone noticed.
  //
  // Uploads are no longer batch-signed here: FilePreviewRow serves bytes
  // through the authenticated /api/files/[id] proxy and its own comment says
  // the signed-URL prop is "accepted for compatibility but no longer read" —
  // the page was paying a storage round trip per render for links nothing
  // rendered.
  const [engagement, items, uploads, firm, user, firmUsers, invoiceSettings] =
    await Promise.all([
      getEngagement(id),
      listRequestItems(id),
      listUploadedFilesForEngagement(id),
      getCurrentFirm(),
      getCurrentUser(),
      listFirmUsers(),
      // Invoice-builder inputs (migration 0750): null = invoicing not set up
      // (builder still works, no taxes / numbering). Session-keyed only.
      getFirmInvoiceSettings(),
    ]);
  if (!engagement) notFound();

  // Everything below the second batch reads these — compute them first so the
  // batch's gates (team mode, payment rails, signature items) are decidable.
  // Send / reminder are locked only once the free trial has expired; an active
  // trial has full access.
  const trialLocked = firm ? isTrialExpired(firm) : false;
  // Delete (incl. delete-draft) is owner-only — hide both controls from staff.
  // The server actions enforce this too; this is the matching UI gate.
  const canDelete = user ? canDeleteEngagements(user.role) : false;
  // "Payable" is rail-agnostic since the PayPal rail (0730): a firm with
  // EITHER Stripe or PayPal ready can invoice.
  const connectReady = firmPaymentRails(firm).any;
  // Assignment (Phase 5): resolve the assignee (may be deactivated — still
  // shown for history) + the active members available as reassignment targets.
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
  // Prompt B: signature items (the accountant supplies a document, the client
  // returns a signed copy) render in their own "Signatures" group, separate
  // from the document-collection checklist.
  const signatureItems = items.filter((i) => i.kind === "signature");

  // The engagement's PRICED lines (#1274) — Canopy's "Services" column on the
  // details card. Awaited on its own rather than in a batch above because it
  // is one small indexed read and everything above it was already in flight.
  // Paired with the schedules (1710) rather than awaited after them: both are
  // small indexed reads on the same engagement, and the Services panel needs
  // them together — "billed monthly" and "next invoice Sept 1" are one fact.
  const [engagementItems, billingSchedules] = await Promise.all([
    listEngagementItems(engagement.id),
    listBillingSchedulesForEngagement(engagement.id),
  ]);
  const collectionItems = items.filter((i) => i.kind !== "signature");

  // Time tracking (1750) — fetched only when the flag is on; a firm with it
  // off pays nothing and sees no tab. Hours only: the type carries no rate.
  const timeEnabled = isTimeInsightsEnabled(firm);
  const timeEntries = timeEnabled
    ? await listEntriesForEngagement(engagement.id)
    : [];

  // SECOND batch: everything keyed off engagement/firm fields, fanned out in
  // parallel. Each thunk chains its own dependents internally (statuses →
  // cached lists, payment row → reconcile → cancel chip), so the page's total
  // depth is two batches plus the self-heal tail — this used to be ~15
  // strictly sequential awaits, most of them 30-80ms round trips to the
  // remote database, re-paid on every 5s AutoRefresh tick.
  const [
    client,
    relationshipData,
    paymentData,
    repeatSeriesRow,
    engagementComments,
    bk,
    signatureRequestsByItem,
    finalDocData,
    handoffRaw,
  ] = await Promise.all([
    getClient(engagement.client_id),
    // Relationships (spec §3, read-only): the compact header line linking to
    // the client's Relationships card, and the recipient scope warning. One
    // query for the client's live links, one for the other ends' names/emails.
    (async () => {
      const rels = await listRelationshipsForClient(engagement.client_id);
      const brief = await listRelatedClientsBrief(
        rels.map((r) =>
          r.from_client_id === engagement.client_id
            ? r.to_client_id
            : r.from_client_id,
        ),
      );
      return { rels, brief };
    })(),
    // Payments (Phase 3): only relevant once the firm can actually receive
    // money. Latest request (status badge) + the dialog's pre-fill amount,
    // then the same self-heals as before — now throttled (see
    // lib/reconcile-throttle.ts) so AutoRefresh ticks don't re-call Stripe /
    // PayPal every 5 seconds for an invoice that is simply still unpaid.
    (async () => {
      if (!connectReady || !firm) {
        return {
          latestPayment: null as PaymentRequest | null,
          lastFirmAmountCents: null as number | null,
          canceledAt: null as string | null,
          showCanceledChip: false,
        };
      }
      const [latestPaymentRaw, lastFirmAmountCents] = await Promise.all([
        getLatestPaymentRequestForEngagement(engagement.id),
        getLastFirmPaymentAmountCents(firm.id),
      ]);
      // Self-heal: if a payment is still "requested" but Stripe already
      // collected it (the webhook can lag or be misconfigured), reconcile
      // straight from Stripe so the accountant sees "Paid" without depending
      // on the webhook.
      let latestPayment = latestPaymentRaw;
      if (
        latestPaymentRaw &&
        latestPaymentRaw.status === "requested" &&
        firm.stripe_connect_account_id &&
        shouldReconcile(`stripe:${latestPaymentRaw.id}`)
      ) {
        const status = await reconcilePaymentRequest(
          latestPaymentRaw.id,
          firm.stripe_connect_account_id,
        );
        if (status && status !== latestPaymentRaw.status) {
          latestPayment = { ...latestPaymentRaw, status };
        }
      }
      // Same self-heal for the PayPal rail: an APPROVED-but-never-captured
      // order (the popup's callback can die) or a capture whose record was
      // lost gets settled here, so the accountant sees "Paid" without
      // depending on a webhook.
      if (
        latestPayment &&
        latestPayment.status === "requested" &&
        latestPayment.paypal_order_id
      ) {
        const paypalMerchantId =
          (firm as { paypal_merchant_id?: string | null } | null)
            ?.paypal_merchant_id ?? null;
        if (
          paypalMerchantId &&
          shouldReconcile(`paypal:${latestPayment.id}`)
        ) {
          const status = await reconcilePayPalOrder(
            latestPayment.id,
            paypalMerchantId,
          );
          if (status && status !== latestPayment.status) {
            latestPayment = { ...latestPayment, status };
          }
        }
      }
      // A canceled (waived) invoice shows a brief "Payment canceled" chip in
      // the header, then hides — the permanent record lives in the audit log.
      // Reconciles never produce "canceled", so this can chain here.
      const cancel =
        latestPayment?.status === "canceled"
          ? await getRecentInvoiceCancel(
              engagement.id,
              PAYMENT_CANCELED_CHIP_WINDOW_MS,
            )
          : { canceledAt: null, recent: false };
      return {
        latestPayment,
        lastFirmAmountCents,
        canceledAt: cancel.canceledAt,
        showCanceledChip: cancel.recent,
      };
    })(),
    // Recurring series (migration 0770): degrades to null pre-migration
    // (getRecurringSeries soft-fails on missing schema), so the page renders
    // with Repeat simply reading "off".
    engagement.series_id
      ? getRecurringSeries(engagement.series_id)
      : Promise.resolve(null),
    // Team Wave 3 (+0930): comments + @mentions on files, checklist items, and
    // the engagement itself. One load for the whole page, only in team mode (a
    // firm-team feature). Empty pre-migration / non-team, so no thread renders.
    teamEnabled
      ? listCommentsForEngagement(id)
      : Promise.resolve(groupEngagementComments([])),
    // Stage 3 (Phase 3): bookkeeping connection statuses, then — when
    // connected — the cached lists, learned matches, stored suggestions,
    // payout journal drafts and (Xero) base currency, all in parallel. The
    // base-currency read used to hide inline in the backfill call's args as
    // one more sequential step.
    (async () => {
      const [xeroStatus, qboStatus] = await Promise.all([
        getClientXeroStatus(engagement.client_id),
        getClientQuickbooksStatus(engagement.client_id),
      ]);
      const provider: "quickbooks" | "xero" | null = xeroStatus
        ? "xero"
        : qboStatus
          ? "quickbooks"
          : null;
      if (!provider) {
        return {
          xeroStatus,
          qboStatus,
          provider,
          suggestions: new Map<string, StoredDraft>(),
          lists: null,
          learned: {} as LearnedMappings,
          tracking: [] as Awaited<
            ReturnType<typeof readCachedXeroTracking>
          >,
          journals: new Map<string, PayoutJournalDraft>(),
          baseCurrency: null as string | null,
        };
      }
      const [suggestions, lists, learned, tracking, journals, baseCurrency] =
        await Promise.all([
          getSuggestionsForEngagement(id),
          provider === "xero"
            ? readCachedXeroLists(engagement.client_id)
            : readCachedQuickbooksLists(engagement.client_id),
          readFirmLearnedMappings(engagement.client_id),
          // Xero-only, and empty for the many organisations that use no
          // tracking — the picker then renders nothing.
          provider === "xero"
            ? readCachedXeroTracking(engagement.client_id)
            : Promise.resolve([]),
          getPayoutJournalsForEngagement(id),
          // See TransactionSuggestion.booksCurrency — Xero only; QuickBooks
          // posts carry no currency, so it keeps the CAD assumption.
          provider === "xero"
            ? readClientXeroBaseCurrency(
                engagement.firm_id,
                engagement.client_id,
              )
            : Promise.resolve(null),
        ]);
      return {
        xeroStatus,
        qboStatus,
        provider,
        suggestions,
        lists,
        learned,
        tracking,
        journals,
        baseCurrency,
      };
    })(),
    // SignWell status per signature item (one query, RLS-scoped), then the
    // same webhook-lag self-heal as before — throttled like the payment
    // reconciles, since "sent"/"viewed" is a signature's status for days.
    (async () => {
      if (signatureItems.length === 0) {
        return new Map<string, SignatureRequest>();
      }
      const map = await getSignatureRequestsByItem(engagement.id);
      const awaitingSigs = [...map.values()].filter(
        (sr) =>
          (sr.status === "sent" || sr.status === "viewed") &&
          shouldReconcile(`signwell:${sr.id}`),
      );
      if (awaitingSigs.length > 0) {
        const reconciled = await Promise.all(
          awaitingSigs.map((sr) => reconcileSignatureRequest(sr)),
        );
        const anyChanged = reconciled.some(
          (s, i) => s !== awaitingSigs[i].status,
        );
        if (anyChanged) {
          // One re-read to pick up new status + signed_file_path on changed rows.
          const fresh = await getSignatureRequestsByItem(engagement.id);
          for (const [k, v] of fresh) map.set(k, v);
        }
      }
      return map;
    })(),
    // Final documents (accountant deliverables) + their pre-signed download
    // links. The accountant download is always allowed — the invoice lock only
    // ever gates the CLIENT's portal download, never the firm. Empty before
    // migration 0620.
    (async () => {
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
      return { finalDocs, finalHrefById };
    })(),
    // The handoff note from the last reassignment. Team-mode only, and only
    // fetched when there IS an assignee — the note is instructions for the
    // person holding the work, so on an unassigned engagement it has no
    // audience.
    teamEnabled && engagement.assigned_user_id
      ? getLatestHandoffNote(engagement.id)
      : Promise.resolve(null),
  ]);

  // ── Per-job access (1320) ────────────────────────────────────────────────
  // Owner-only, team-only, and only once the engagement is more than a draft.
  // Placed AFTER the second batch on purpose: `client` is resolved in it, and
  // this needs the client's assignee to work out who is already covered.
  // Skipped entirely for everybody else — a staff member never pays two reads
  // for a control they cannot see.
  const canGrantJobAccess =
    user?.role === "owner" && teamEnabled && engagement.status !== "draft";
  const [jobGuestRows, clientCastRows] = canGrantJobAccess
    ? await Promise.all([
        listEngagementMembers(id),
        listClientMembers(engagement.client_id),
      ])
    : [[], []];

  // WHO IS ON THIS JOB (1540). The union of the primary and the extra rows —
  // resolveAssignees owns that rule so the card and the list cannot disagree.
  const assigneeIds = resolveAssignees(
    engagement.assigned_user_id,
    (await listEngagementAssignees(id)).map((a: { userId: string }) => a.userId),
  );

  // The FIRM's own steps (1340). Read for everybody who can open the page —
  // unlike the access control above, this is the work itself, not a permission
  // screen. Empty until the migration lands, which reads as "nothing planned".
  // Both reads together: the job's tasks, and the firm's statuses that give
  // them their labels and colours. listTaskStatuses is request-cached, so this
  // costs nothing on a page that already asked for them.
  const [internalTasks, taskStatuses] = await Promise.all([
    listEngagementTasks(id),
    listTaskStatuses(),
  ]);
  // The steps inside each of them, batched by parent.
  const subtasksByParent = await listSubtasksByParent(
    internalTasks.map((x) => x.id),
  );
  const jobGuestIds = new Set(jobGuestRows.map((m) => m.userId));
  // Anyone who can ALREADY see this through the client is not a candidate:
  // adding them would grant nothing, and removing them later would take
  // nothing away. The control lists EXCEPTIONS, not the audience.
  const coveredByClient = new Set<string>([
    ...clientCastRows.map((m) => m.userId),
    ...(client?.assigned_user_id ? [client.assigned_user_id] : []),
  ]);
  const jobGuests = activeMembers.filter((m) => jobGuestIds.has(m.id));
  const jobCandidates = activeMembers.filter(
    (m) =>
      !jobGuestIds.has(m.id) &&
      !coveredByClient.has(m.id) &&
      m.id !== user?.id &&
      m.id !== engagement.assigned_user_id,
  );

  const clientRelationships = relationshipData.rels;
  const relatedBrief = relationshipData.brief;
  const { latestPayment, lastFirmAmountCents } = paymentData;
  const invoiceCanceledAt = paymentData.canceledAt;
  const showCanceledChip = paymentData.showCanceledChip;
  const bookkeepingProvider = bk.provider;
  const bookkeepingConnected = bookkeepingProvider != null;
  const bkLists = bk.lists;
  const bkLearned = bk.learned;
  const bkTracking = bk.tracking;
  const { finalDocs, finalHrefById } = finalDocData;

  const relatedById = new Map(relatedBrief.map((c) => [c.id, c]));
  // "Owned by Zachary Thresh · 100%" when the ONLY link is a single owner;
  // otherwise "N linked clients". Resolvable links only (RLS may hide a
  // private other end from staff — then the count matches what they can see).
  const visibleRelationships = clientRelationships.filter((r) =>
    relatedById.has(
      r.from_client_id === client?.id ? r.to_client_id : r.from_client_id,
    ),
  );
  const soleOwnerLink =
    client &&
    visibleRelationships.length === 1 &&
    visibleRelationships[0].rel_type === "owner_of" &&
    visibleRelationships[0].to_client_id === client.id
      ? visibleRelationships[0]
      : null;
  // Recipient safety (spec §3): everything sent on this engagement goes to the
  // client record's email — when that address belongs to a linked authorized
  // contact whose scopes don't cover this engagement's domain, warn (never
  // block). Deterministic email match; no inference.
  const scopeWarningContact =
    client && client.type === "business"
      ? findScopeWarning(
          client.email,
          engagement.type,
          clientRelationships
            .filter(
              (r) =>
                r.rel_type === "authorized_contact" &&
                r.to_client_id === client.id &&
                relatedById.has(r.from_client_id),
            )
            .map((r) => {
              const c = relatedById.get(r.from_client_id)!;
              return {
                clientId: c.id,
                name: c.display_name,
                email: c.email,
                scopes: r.scopes ?? [],
              };
            }),
        )
      : null;
  const paymentPrefillCents = resolveDefaultAmountCents(
    firm?.service_prices,
    engagement.type,
    lastFirmAmountCents,
  );
  const paymentPrefill =
    paymentPrefillCents != null ? (paymentPrefillCents / 100).toFixed(2) : "";
  const repeatSeries = repeatSeriesRow
    ? {
        id: repeatSeriesRow.id,
        frequency: repeatSeriesRow.frequency,
        // Custom schedules ("every N months on day D") prefill the dialog.
        intervalMonths: repeatSeriesRow.interval_months ?? null,
        anchorDay: repeatSeriesRow.anchor_day,
        dueOffsetDays: repeatSeriesRow.due_offset_days,
        status: repeatSeriesRow.status,
        nextSpawnOn: repeatSeriesRow.next_spawn_on,
        itemsCount: Array.isArray(repeatSeriesRow.items)
          ? repeatSeriesRow.items.length
          : 0,
        invoiceRecreate: repeatSeriesRow.invoice_recreate === true,
      }
    : null;
  // Invoice recurrence plumbing: whether THIS engagement has invoice material
  // to copy (same precedence rule the actions use), and — when recurrence is
  // on — a one-line summary of the SERIES' stored snapshot (what will
  // actually spawn).
  const currentInvoiceSnap = deriveInvoiceSnapshotFromEngagement(
    engagement,
    latestPayment
      ? {
          status: latestPayment.status,
          amount_cents: latestPayment.amount_cents,
          locks_deliverables: latestPayment.locks_deliverables === true,
          description: latestPayment.description,
        }
      : null,
  );
  const repeatInvoiceAvailable = currentInvoiceSnap != null;
  const storedInvoiceSnap = repeatSeriesRow
    ? parseInvoiceSnapshot(repeatSeriesRow.invoice_snapshot)
    : null;
  // Has this engagement's setup drifted from what the series would spawn?
  // Drives the "Apply to future occurrences?" prompt + the dialog's
  // edit-future box (both appear only when there is something to apply).
  const repeatSeriesOutOfSync =
    repeatSeriesRow != null &&
    repeatSeriesRow.status !== "ended" &&
    !engagementMatchesSeries({
      series: {
        items: Array.isArray(repeatSeriesRow.items)
          ? repeatSeriesRow.items
          : [],
        reminder_settings: repeatSeriesRow.reminder_settings,
        ai_enabled: repeatSeriesRow.ai_enabled,
        invoice_recreate: repeatSeriesRow.invoice_recreate === true,
        invoiceSnapshot: storedInvoiceSnap,
      },
      engagement: {
        itemsSnapshot: snapshotFromRequestItems(items),
        reminder_settings: engagement.reminder_settings,
        ai_enabled: engagement.ai_enabled !== false,
        invoiceSnapshot: currentInvoiceSnap,
      },
    });
  // Default-prices presets as one-tap line items for the invoice builder
  // (invoiceSettings itself was fetched in the first batch).
  const tSettings = await getTranslations("Settings");
  const presetDefs = [
    { key: "t1", label: tSettings("service_price_t1") },
    { key: "t2", label: tSettings("service_price_t2") },
    { key: "bookkeeping", label: tSettings("service_price_bookkeeping") },
  ];
  // The engagement's live invoice, in the shape the invoice dialog wants.
  // Extracted to a variable because TWO mounts of that dialog need it now: the
  // header kebab's, and the trigger-less one that ?panel=invoice opens for
  // Billing → New invoice. Building it inline twice is how the two would drift.
  const invoiceForOptions = latestPayment
    ? {
        id: latestPayment.id,
        status: latestPayment.status,
        amount_cents: latestPayment.amount_cents,
        description: latestPayment.description,
        locks_deliverables: latestPayment.locks_deliverables,
        override_unlocked: latestPayment.override_unlocked,
        // Native-invoice fields (0750) for the builder's edit mode;
        // null/undefined on legacy simple rows.
        invoice_kind: latestPayment.invoice_kind ?? null,
        invoice_number: latestPayment.invoice_number ?? null,
        line_items: latestPayment.line_items ?? null,
        tax_breakdown: latestPayment.tax_breakdown ?? null,
        tax_total_cents: latestPayment.tax_total_cents ?? null,
        due_date: latestPayment.due_date ?? null,
        invoice_terms: latestPayment.invoice_terms ?? null,
        invoice_notes: latestPayment.invoice_notes ?? null,
        invoice_language: latestPayment.invoice_language ?? null,
      }
    : null;

  const invoiceBuilder = {
    settings: invoiceSettings
      ? {
          province: invoiceSettings.province,
          invoicePrefix: invoiceSettings.invoice_prefix,
          nextInvoiceSeq: invoiceSettings.next_invoice_seq,
          defaultTerms: invoiceSettings.default_terms,
          defaultNotes: invoiceSettings.default_notes,
          defaultTaxesEnabled: invoiceSettings.default_taxes_enabled,
          // Pre-fills the builder's due date (migration 1330). `undefined` on a
          // pre-1330 read collapses to null, which the builder reads as "leave
          // the field blank" — exactly the old behaviour.
          defaultDueDays: invoiceSettings.default_due_days ?? null,
        }
      : null,
    presets: presetDefs.flatMap(({ key, label }) => {
      const cents = firm?.service_prices?.[key];
      return typeof cents === "number" && cents > 0
        ? [{ key, label, unitCents: Math.round(cents) }]
        : [];
    }),
    // The invoice document's default language = the client's portal language
    // (overridable per invoice in the builder).
    clientLocale: (client?.locale === "en" ? "en" : "fr") as "en" | "fr",
  };
  // Whether the Final documents are locked, for the compact lock icon on the
  // header pill (same rule the portal + download route use).
  const deliverablesLocked = computeDeliverablesLocked({
    invoice: latestPayment,
    engagementLocksDeliverables: engagement.invoice_locks_deliverables === true,
  });

  const commentsByFile = engagementComments.byFile;

  const filesByItem = new Map<string, UploadedFile[]>();
  for (const u of uploads) {
    const arr = filesByItem.get(u.request_item_id) ?? [];
    arr.push(u);
    filesByItem.set(u.request_item_id, arr);
  }

  // Stage 3 (Phase 3): the read-only DRAFT suggestion cards. Relevant when this
  // client is connected to a bookkeeping product — QuickBooks OR Xero (0790).
  // A client connects EITHER, never both, so the provider is unambiguous; Xero
  // is checked first (per-client from day one). The cached lists come from the
  // matching product (Xero's adapter returns the SAME QuickbooksLists shape the
  // matcher + pickers consume), so everything downstream is provider-neutral.
  // Per-client (0710): this engagement's connection, cached lists, and learned
  // matches are THIS client's. Everything degrades gracefully to nothing when
  // this client isn't connected / before the migrations land. (All fetched in
  // the second batch above.)
  let suggestionsByFile = bk.suggestions;
  // Self-heal: regenerate any draft that's missing but whose file already has a
  // stored transaction read (re-upload race / pre-migration classify / cleanup),
  // mirroring the payment + signature reconcile-on-load above. Cheap (no AI
  // call) and only re-reads when it actually created something.
  if (bookkeepingConnected && bkLists) {
    const created = await backfillMissingSuggestions({
      firmId: engagement.firm_id,
      engagementId: id,
      files: uploads.map((u) => ({
        id: u.id,
        ai_extracted_fields: u.ai_extracted_fields,
      })),
      lists: bkLists,
      learned: bkLearned,
      existingFileIds: new Set(suggestionsByFile.keys()),
      provider: bookkeepingProvider ?? "quickbooks",
      // See TransactionSuggestion.booksCurrency — Xero only; QuickBooks posts
      // carry no currency, so it keeps the CAD assumption. Prefetched in the
      // second batch (bk.baseCurrency) — it used to hide here as one more
      // sequential round trip inside this call's arguments.
      booksCurrency: bk.baseCurrency,
    });
    if (created > 0) suggestionsByFile = await getSuggestionsForEngagement(id);
  }
  // Payout journal drafts (migration 1010), one per processor-statement
  // upload. Created lazily below for any payout that was read but has no draft
  // yet — the same self-heal shape as the transaction backfill above, and just
  // as cheap (no AI call, pure DB). In the steady state (every draft exists)
  // the loop performs zero awaits.
  let payoutJournals = bk.journals;
  if (bookkeepingConnected) {
    let createdJournals = 0;
    for (const u of uploads) {
      if (payoutJournals.has(u.id)) continue;
      const card = payoutCardData(u.ai_extracted_fields);
      if (!card) continue;
      const made = await ensurePayoutJournalDraft({
        firmId: engagement.firm_id,
        uploadedFileId: u.id,
        engagementId: id,
        provider: bookkeepingProvider ?? "quickbooks",
        figures: card.figures,
      });
      if (made) createdJournals += 1;
    }
    if (createdJournals > 0) {
      payoutJournals = await getPayoutJournalsForEngagement(id);
    }
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

  // The cached bookkeeping lists the accountant picks from (active entries only).
  // Same DraftCardOptions shape whether the source is QuickBooks or Xero (Xero's
  // adapter already produced the QuickbooksLists shape).
  const toOpt = (x: { id: string; name: string }) => ({
    id: x.id,
    name: x.name,
  });
  const isPayFrom = (t: string | null) =>
    ["bank", "credit card"].includes((t ?? "").toLowerCase());
  const qboOptions: DraftCardOptions = {
    vendors: (bkLists?.vendors ?? []).filter((x) => x.active).map(toOpt),
    customers: (bkLists?.customers ?? []).filter((x) => x.active).map(toOpt),
    accounts: (bkLists?.accounts ?? []).filter((x) => x.active).map(toOpt),
    // Exclude "adjustment" tax codes: they have no purchase/sales rate and the
    // product rejects them on a transaction (QuickBooks tax-calc ValidationFault
    // 6000); harmless to apply to Xero (its rates aren't named this way).
    taxCodes: (bkLists?.taxCodes ?? [])
      .filter((x) => x.active && isSelectableTaxCode(x.name))
      .map(toOpt),
    items: (bkLists?.items ?? []).filter((x) => x.active).map(toOpt),
    paymentAccounts: (bkLists?.accounts ?? [])
      .filter((x) => x.active && isPayFrom(x.accountType))
      .map(toOpt),
    tracking: bkTracking,
  };
  // The same accounts, keeping the TYPE. The payout journal needs it: Xero
  // refuses a journal entry that touches a bank balance, and the type is the
  // only way to keep those out of the picker instead of failing at post time.
  const journalAccounts: TypedAccount[] = (bkLists?.accounts ?? [])
    .filter((x) => x.active)
    .map((x) => ({ id: x.id, name: x.name, type: x.accountType }));

  // Client messaging (the thread + its unread count) now lives entirely in the
  // chat popup, fetched client-side from /api/client-messages — the engagement
  // page no longer loads or computes it.

  const t = await getTranslations("Engagements");
  // Invoice-recurrence summary of the SERIES' stored snapshot (needs `t`, so
  // it lives here; the snapshot itself was parsed with the series above).
  const repeatInvoiceSummary = storedInvoiceSnap
    ? `${formatCurrency(storedInvoiceSnap.amount_cents / 100, locale)} · ${
        storedInvoiceSnap.timing === "at_spawn"
          ? t("repeat_invoice_timing_at_spawn")
          : storedInvoiceSnap.timing === "on_completion"
            ? t("repeat_invoice_timing_on_completion")
            : t("repeat_invoice_timing_delayed", {
                days: storedInvoiceSnap.delay_days ?? 0,
              })
      }`
    : null;
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
  // Scope names live in the Clients namespace (shared with the profile card).
  const tClients = await getTranslations("Clients");
  const relHeaderLine = soleOwnerLink
    ? t("rel_owned_by", {
        name:
          relatedById.get(soleOwnerLink.from_client_id)?.display_name ?? "",
        pct: soleOwnerLink.percentage ?? 0,
      })
    : visibleRelationships.length > 0
      ? t("rel_linked_count", { count: visibleRelationships.length })
      : null;
  const scopeWarningText = scopeWarningContact
    ? t("rel_scope_warning", {
        name: scopeWarningContact.name,
        scopes: scopeWarningContact.scopes
          .map((s) => tClients(`rel_scope_${s}`))
          .join(", "),
      })
    : null;

  // The handoff note (fetched in the second batch). reviewerNameById already
  // holds every firm user, deactivated included, so a note written by someone
  // who has since left still shows their name.
  const handoff = handoffRaw
    ? {
        note: handoffRaw.note,
        from:
          (handoffRaw.actorId
            ? reviewerNameById.get(handoffRaw.actorId)
            : null) ?? null,
        at: formatDate(handoffRaw.at, locale, "medium"),
      }
    : null;

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

  // Workflow stage (migration 0690). The stage itself is READ, never resolved
  // here — the event handlers keep it fresh (lib/engagements/stage-sync), so the
  // page just renders what's stored. undefined pre-migration, or null for a
  // draft / cancelled engagement, in which case the header keeps its status pill
  // and no stepper renders.
  const stage = engagement.stage ?? null;

  // THE SAME RESOLVER the engagements list and the detail panel use, so the
  // header, the card's pill and the list row cannot disagree about one job.
  const agreementStatus = resolveAgreementStatus({
    status: engagement.status,
    sentAt: engagement.sent_at ?? null,
    completedAt: engagement.completed_at ?? null,
    // The acceptance step exists now (1640). A NULL still reads as not
    // accepted, which is what every historical engagement is — the other
    // default would mark them all as agreed to by a client never asked.
    acceptedAt: engagement.accepted_at ?? null,
    activatedAt: engagement.activated_at ?? null,
    // "The client has done something since we sent it" is the honest stand-in
    // for live until acceptance draws that line properly.
    clientHasEngaged: attention.daysSinceClientActivity != null,
  });
  // Which nodes the stepper draws: the skip logic. An engagement with no
  // signature items never shows Awaiting signature; one with no live invoice
  // never shows Awaiting payment. A cancelled (waived) invoice doesn't count —
  // nothing is owed, so that stage will never be reached. `stage` is passed so a
  // manual override to a stage this engagement has no structural claim to still
  // draws the node it's standing on.
  // ⚠️ stepperStages / stageEntered were DELETED WITH THE STAGE STEPPER, not
  // lost: `stage`, stage_history, applicableStages() and stageEnteredAt() all
  // still exist and are still correct. They get recomputed wherever the
  // pipeline lands on the document-collection TASK. Recomputing them here for
  // nothing was two reads and a parse on every engagement page load.

  const isLive =
    engagement.status === "sent" || engagement.status === "in_progress";
  const isDraft = engagement.status === "draft";
  const isComplete = engagement.status === "complete";
  return (
    <div className="space-y-6">
      {/* ?panel=messages (the notifications Reply chip) opens the chat popup
          straight in Client-messages mode. */}
      {sp.panel === "messages" && <OpenPanelOnLoad tab="messages" />}
      {/* ?comment=1 (the dashboard worklist's right-click "Add a comment")
          opens the engagement-level comment composer on arrival. */}
      {sp.comment === "1" && teamEnabled && (
        <OpenCommentComposerOnLoad
          commentKey={commentKeyForEngagement(engagement.id)}
        />
      )}
      {/* Auto-refresh while the engagement is still active. Picks up new
          client uploads + AI verdicts + activity-log entries without
          requiring the accountant to hit reload. Skipped for draft /
          complete / cancelled engagements since nothing changes there. */}
      {isLive && <AutoRefresh intervalMs={5000} />}

      {/* Publishes this engagement's view to the sidebar so the matching
          sub-page highlights. Renders nothing. */}
      <SetEngagementDetailView view={view} />

      {/* ⚠️ THE BREADCRUMB THAT USED TO SIT HERE RENDERED NOTHING. Its comment
          claimed "the crumbs return to the right list", but
          components/ui/breadcrumb.tsx is a stub that returns null — breadcrumb
          navigation was switched off site-wide — so this page has had NO way
          back for as long as that has been true. The back arrow now on the
          title row is the first working one, and it keeps what the crumbs
          promised: it returns to the SUB-LIST you came from (Drafts, Ready to
          review, …), not to a generic /engagements. */}

      {/* Floating "Apply to future occurrences?" prompt — only when this
          engagement's setup actually drifted from its series. Fixed
          bottom-right; self-dismissing per tab session. */}
      {repeatSeriesOutOfSync && repeatSeries && (
        <SeriesSyncPrompt
          seriesId={repeatSeries.id}
          engagementId={engagement.id}
        />
      )}

      {/* ── HEADER ROW, IN CANOPY'S ORIENTATION ──────────────────────────
          Founder: "you dont need to do the header row with the download ·
          duplicate. But i like how the header row is oriented visually with
          the title and stuff."

          So ONE line carries what identifies this job — back · title · client
          — and closes with the action cluster and the kebab. DOWNLOAD AND
          DUPLICATE ARE DELIBERATELY ABSENT: the founder dropped both by name,
          and download already lives inside the "..." menu.

          The rows below are unchanged in content and deliberately so: the
          badges keep the exceptions, and the stage stepper + Assigned-to keep
          their own rows. Canopy has no counterpart for either, which makes
          them easy to lose while copying its shape — they are live Vylan
          controls and the founder asked for the ORIENTATION, not a cull. */}
      <header className="flex flex-wrap items-start justify-between gap-3 animate-in-up">
        <div className="min-w-0">
          {/* Title and the live "who else is here" row are SIBLINGS in a flex
              row, not nested. The facepile used to live inside the <h1>, where
              it inherited the heading's 3xl line-height and font metrics and so
              sat on the text baseline, jammed against the last letter. A 22px
              circle cannot share a baseline with 30px type and look deliberate.
              items-center + gap-3 lets the row centre the avatars against the
              title's optical middle instead. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Back sits INSIDE the title row rather than on a line of its own
                (which is where the client profile puts its own BackLink). That
                is the whole of what the founder liked about Canopy's header:
                one line that says where you are and how to leave. -ml-2 hangs
                the arrow into the page gutter so the TITLE stays optically
                aligned with the cards beneath it. */}
            <BackLink
              variant="inline"
              href={viewHref(view)}
              label={t("back_to_list", { list: t(viewLabelKey(view)) })}
              className="-ml-2"
            />
            <h1 className="text-3xl font-semibold tracking-tight">
              {engagement.title}
            </h1>
            {/* The client, lifted out of the badge row below onto the title
                line — Canopy puts "whose job is this" beside the job's name,
                and it was the one thing down there that was an ANSWER rather
                than an exception. A hairline separates it from the title so a
                two-word client name does not read as part of it. */}
            {client && (
              <span className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden
                  className="h-4 w-px bg-border max-sm:hidden"
                />
                <Link
                  href={`/clients/${client.id}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {client.display_name}
                </Link>
              </span>
            )}
            {/* Team-mode only: a solo firm has nobody to be present. Renders
                nothing when you are the only one looking, which is most of the
                time — so this usually costs the row no height at all. */}
            {teamEnabled && user && (
              <EngagementPresence
                firmId={engagement.firm_id}
                engagementId={engagement.id}
                viewerId={user.id}
                roster={activeMembers}
              />
            )}
          </div>
          <div className="flex items-center gap-2 mt-2.5 text-sm flex-wrap">
            {/* No workflow position (a draft or cancelled engagement, or an
                environment where migration 0690 hasn't been applied) → the
                status pill stays exactly as before. A live engagement's
                position is shown by the stepper below instead: it says
                everything this pill did and more. */}
            {!stage && (
              <Badge
                variant={statusVariant(derivedStatus)}
                className={engagementStatusPillClass(derivedStatus)}
              >
                {tStatus(derivedStatus)}
              </Badge>
            )}
            {engagement.series_id && (
              <RecurringBadge label={t("repeat_badge")} />
            )}
            {/* The client link MOVED UP to the title row. It is not gone —
                deleting it would strand the one link off this page to the
                person the work is for. */}
            {/* Relationships, read-only (spec §3): "Owned by X · 100%" or
                "N linked clients", pointing at the profile's Relationships
                card. Detail lives there, not here. */}
            {client && relHeaderLine && (
              <Link
                href={`/clients/${client.id}#relationships`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Link2 className="size-3" aria-hidden />
                {relHeaderLine}
              </Link>
            )}
            {/* The due date moved into the Engagement details card, which
                owns every date now. Printing it here as well was the same
                fact in two places two inches apart. */}
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
            {/* Not on drafts: a draft's privacy toggle lives in the ⋯ menu, which
                only appears once the engagement is sent — so we don't show a
                "Private" badge the owner can't act on yet. */}
            {user?.role === "owner" && engagement.is_private && !isDraft && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 text-xs text-amber-600 dark:text-amber-400"
              >
                <Lock className="size-3" aria-hidden="true" />
                {t("private_badge")}
              </Badge>
            )}
          </div>
          {/* Who has been let into THIS job only.
              Founder: "hide this somewhere more subtle. it doesnt deserve to be
              on the main page" — and they are right; it is a rare deliberate
              act wearing the clothes of a daily control.

              ⚠️ HIDDEN WHEN THERE ARE NO GUESTS, NOT DELETED. Anyone who HAS
              been let into this job still shows, because this is a privacy
              control: a grant you cannot see is a grant you cannot revoke, and
              making existing access invisible is a strictly worse bug than the
              clutter being removed.

              What is temporarily unreachable is GRANTING new access on a job
              with none. That is deliberate and on the record (.active-sessions
              .md): the entry point moves into the "..." menu next, which is
              where the other rare per-engagement controls already live. */}
          {canGrantJobAccess && jobGuests.length > 0 && (
            <div className="mt-2">
              <EngagementAccess
                engagementId={id}
                guests={jobGuests}
                candidates={jobCandidates}
              />
            </div>
          )}
          {/* Recipient safety (spec §3): Vylan has no per-send recipient
              picker — every send on this engagement (portal link, reminder,
              signature request, invoice) goes to the client record's email.
              When that address belongs to a linked authorized contact whose
              scopes don't cover this engagement's domain, say so ONCE, here,
              above all of those send controls. Warning only — sending is
              never blocked; the accountant decides. */}
          {scopeWarningText && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {scopeWarningText}
            </p>
          )}
          {/* ⚠️ THIS WAS THE WORKFLOW-STAGE STEPPER AND IS NOW THE AGREEMENT.
              Founder: "the old engagement statuses still exist on the full
              engagement view. I wanted them to only exist for document
              collection. Keep the same ui just rename it to match engagements."

              Same rail, same dots, same spacing — six workflow stages replaced
              by the agreement's own progression, which is the thing an
              ENGAGEMENT actually has. It is READ-ONLY where the old one was a
              dropdown, and that is deliberate: an agreement status is derived
              from facts that already exist (was it sent, has the client done
              anything, is it complete), so there is nothing to set. Offering to
              set "Accepted" on an engagement no client accepted is the dead
              control this codebase keeps deleting.

              `stage` is UNTOUCHED in the database and still resolved above —
              nothing here deletes it. Its home becomes the document-collection
              TASK, which is where the founder always wanted the pipeline; note
              their constraint when building that: an engagement can hold
              SEVERAL tasks of the same kind, so the pipeline belongs to each
              task individually, never to "the" doc-collection task. */}
          <div className="mt-3">
            <AgreementStepper status={agreementStatus} />
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
                viewerId={user?.id ?? ""}
                handoff={handoff}
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
              ) : (
                /* NO documents gate. This button used to be permanently
                   disabled on an engagement that requested no files, which made
                   a proposal-only engagement impossible to send — see
                   sendEngagementAction for the full reasoning. */
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
                  icon={<BellRing className="size-4" />}
                  reasonKey="block_send_reminder_reason"
                  variant="outline"
                  size="sm"
                  className="group h-8 w-8 gap-0 overflow-hidden px-0 transition-[width,padding,gap] duration-200 hover:w-40 hover:gap-1.5 hover:px-3 focus-visible:w-40 focus-visible:gap-1.5 focus-visible:px-3"
                  labelClassName="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-36 group-hover:opacity-100 group-focus-visible:max-w-36 group-focus-visible:opacity-100"
                />
              ) : (
                <SendReminderButton engagementId={engagement.id} />
              )}
              {/* Mark complete — the clear primary action. Plain default
                  button hover (no green tint) per founder preference. When the
                  firm requires an owner's sign-off, staff see a disabled button
                  + hint instead (an owner marks it done). */}
              {/* ── ACCEPTANCE (1640) ────────────────────────────────────
                  Each button appears only in the state it belongs to, which is
                  Karbon's model: an action offered in the wrong state is a
                  button that either does nothing or does something surprising.

                  SENT, not yet agreed -> record that they agreed elsewhere. */}
              {agreementStatus === "sent" && (
                <form action={acceptOnBehalfAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button type="submit" size="sm" variant="outline">
                    {t("accept_on_behalf")}
                  </Button>
                </form>
              )}
              {/* AGREED, not yet started -> let the work begin. Signing is the
                  client's act; starting is the firm's. */}
              {agreementStatus === "accepted" && (
                <form action={activateEngagementAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button type="submit" size="sm">
                    {t("activate_engagement")}
                  </Button>
                </form>
              )}
              {/* SENT or AGREED -> pull it back to edit. Destructive: it
                  withdraws the send AND clears the acceptance, because editing
                  what a client agreed to while keeping their agreement on the
                  record is the one outcome this must make impossible. */}
              {(agreementStatus === "sent" ||
                agreementStatus === "accepted") && (
                <form action={revertEngagementToDraftAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {t("revert_to_draft")}
                  </Button>
                </form>
              )}
              {(
                <form action={completeEngagementAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button type="submit" size="sm">
                    <CheckCircle2 className="size-4" />
                    {t("mark_complete")}
                  </Button>
                </form>
              )}
            </>
          )}
          {/* Compact invoice status pill (a lock icon when the Final documents
              are locked). All invoice actions now live in the "..." menu's
              Invoice option, to keep the header calm. */}
          {latestPayment &&
            paymentStatusLabel &&
            latestPayment.status !== "canceled" && (
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
                {deliverablesLocked && <Lock className="size-3" aria-hidden />}
                {paymentStatusLabel} ·{" "}
                {formatCurrency(latestPayment.amount_cents / 100, locale)}
              </Badge>
            )}
          {/* Canceled/waived is transient: show the chip for a few minutes after
              the waive, then hide it. The event stays permanent in the Activity
              feed + audit log. */}
          {latestPayment?.status === "canceled" &&
            paymentStatusLabel &&
            showCanceledChip &&
            invoiceCanceledAt && (
              <PaymentCanceledChip
                canceledAt={invoiceCanceledAt}
                label={paymentStatusLabel}
                amountLabel={formatCurrency(
                  latestPayment.amount_cents / 100,
                  locale,
                )}
              />
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
          {/* No Activity affordance here, by design (#1044). History belongs
              in the owner's audit log at /settings/audit, filtered by client or
              by person — not as a door on a page every teammate opens. Who is
              LOOKING at this job is a live question, answered by presence at
              the top of the page; who TOUCHED it months ago is an audit
              question and belongs where audit questions are answered. */}
          {/* Engagement-level comments (team mode): the bubble sits with the
              header's other controls and stays invisible until this engagement
              has a comment — or until the worklist right-click / the "..."
              menu asks for the composer. */}
          {teamEnabled && (
            <CommentThread
              engagementId={engagement.id}
              target={{ kind: "engagement" }}
              initialComments={engagementComments.engagement}
              members={activeMembers}
              currentUserId={user?.id ?? null}
              locale={locale}
              quotedText={engagement.title}
            />
          )}
          {/* The "..." menu holds reminder and invoice settings, copy links,
              downloads, cancellation, and deletion so only primary buttons +
              the payment pill stay in the row. Delete keeps its confirmation +
              30-day recovery. Drafts keep their own inline Send + Delete-draft
              buttons and never get it. */}
          {!isDraft && (
            <EngagementMoreMenu
              engagementId={engagement.id}
              locale={locale}
              commentable={teamEnabled}
              // The door the hidden row needed. Only when this viewer can
              // actually grant — otherwise the item would open a dialog whose
              // every action is refused.
              access={
                canGrantJobAccess
                  ? { guests: jobGuests, candidates: jobCandidates }
                  : undefined
              }
              privacy={
                teamEnabled && user?.role === "owner"
                  ? {
                      isOwner: true,
                      isPrivate: engagement.is_private ?? false,
                    }
                  : undefined
              }
              repeatSeries={repeatSeries}
              repeatInvoiceAvailable={repeatInvoiceAvailable}
              repeatInvoiceSummary={repeatInvoiceSummary}
              repeatSeriesOutOfSync={repeatSeriesOutOfSync}
              status={isLive ? "live" : isComplete ? "complete" : "cancelled"}
              remindersPaused={engagement.reminders_paused}
              reminderSettings={normalizeReminderSettings(
                engagement.reminder_settings,
              )}
              hasUploads={uploads.length > 0}
              canDelete={canDelete}
              clientLinkToken={
                isLive ? (engagement.magic_token ?? undefined) : undefined
              }
              connectReady={connectReady}
              invoice={invoiceForOptions}
              engagementLocksDeliverables={
                engagement.invoice_locks_deliverables === true
              }
              invoiceDefaultAmount={paymentPrefill}
              invoiceBuilder={invoiceBuilder}
              invoiceAutomation={{
                mode: engagement.invoice_auto_mode ?? "off",
                delayDays: engagement.invoice_delay_days ?? null,
                amountCents: engagement.invoice_amount_cents ?? null,
                description: engagement.invoice_description ?? null,
                locksDeliverables:
                  engagement.invoice_locks_deliverables === true,
              }}
            />
          )}
        </div>
      </header>

      {/* ── THE FACTS, IN CANOPY'S SHAPE ──────────────────────────────────
          Founder, with thirteen screenshots: "I want to copy their UI and the
          actual process itself... the way it's structured."

          Three columns that never move — who owes a signature, when it
          happened, what we are doing — replacing a header that answered all
          three by being read in full. The header above keeps the CONTROLS
          (stage, assignee, the kebab); this card holds the FACTS. */}
      <EngagementDetailsCard
        locale={locale}
        people={
          // ⚠️ AVATARS, NOT TWO LINES OF TEXT. Founder: "Theres not even a
          // profile picture circle view." Canopy's card leads with round faces
          // because "who is on this" is answered by recognising a person, not
          // by reading their name — and the app already draws exactly these
          // circles for presence and for the assignee control. The card was
          // the one place that printed a string instead.
          <div className="flex items-center gap-2">
            {/* RE-WIRED (#1325 unwired it). The previous session left an exact
                recipe and one warning worth keeping: an add is only trusted
                once it SURVIVES A RELOAD, because seeing the face appear is the
                optimistic preview, not evidence.

                WHAT THE BUG TURNED OUT TO BE, since the note guessed otherwise:
                not the click path and not the write. On success the control
                called setOptimistic(null), which means "render the PROP again"
                — and the prop is still the pre-add list until router.refresh()
                lands new props. So the face appeared and then VANISHED, which
                reads exactly like a silent failure even though the row was
                written. Its remove looked fine because removing the PRIMARY
                also writes engagements.assigned_user_id, which the same refresh
                brings back. Same shape as the statuses editor: the write was
                never the problem, the screen was.

                The service-role upsert the note proved against production could
                never have caught it — service role bypasses RLS, and so does
                this table's writer by design (its policy grants SELECT only and
                the actions layer is the gate). */}
            <EngagementAssigneesControl
              engagementId={engagement.id}
              assigneeIds={assigneeIds}
              primaryId={engagement.assigned_user_id}
              members={activeMembers}
              canEdit={teamEnabled}
            />
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium text-foreground">
                {assignee ? userDisplayLabel(assignee) : t("unassigned")}
              </div>
              {client && (
                <div className="truncate text-xs text-muted-foreground">
                  {client.display_name}
                </div>
              )}
            </div>
          </div>
        }
        // Vylan has ONE signer — the client — and N documents for them to
        // sign (SignWell is wired to a single signer). So the count is
        // documents, as Canopy's is, and the row is the person.
        signers={
          signatureItems.length > 0 && client
            ? [
                {
                  name: client.display_name,
                  signed: signatureItems.every((i) => i.status === "approved"),
                },
              ]
            : []
        }
        sentAt={engagement.sent_at ?? null}
        // A sent engagement has begun; a draft has not, and Canopy words that
        // exact state "On acceptance".
        startsAt={engagement.sent_at ?? null}
        // ⚠️ ALWAYS NULL TODAY. Vylan has no client-acceptance step until the
        // creation wizard's later phases; deriving it from sent_at would claim
        // a client agreed to something they were only shown.
        acceptedAt={null}
        dueDate={engagement.due_date ?? null}
        // The engagement's priced line names — Canopy's Services column. Loaded
        // here rather than by the card so the card stays a pure presenter.
        services={engagementItems.map((i) => i.name).filter(Boolean)}
        // Canopy's "12 month agreement". Vylan knows this only when the job
        // is part of a recurring series — a one-off has no term, and inventing
        // one would put a promise on the card that nobody made.
        agreementNote={
          repeatSeries ? t("details_recurring") : null
        }
        // ⚠️ THE AGREEMENT, not the workflow stage. This pill was the LAST
        // place the old stage words survived on this page — the founder found
        // it reading "Awaiting payment" two inches from a stepper that already
        // said "Active", which is the two-vocabularies problem the whole
        // agreement remodel exists to end. Same chip and same resolver as the
        // engagements list, so a job cannot describe itself differently in two
        // places. The old branch also disagreed with ITSELF: a stage chip when
        // a stage resolved and a raw status badge otherwise.
        statusChip={<AgreementChip status={agreementStatus} />}
      />

      {/* Billing → New invoice arrives as ?panel=invoice. Mounted HERE, at page
          level, rather than inside the header kebab: Radix unmounts the menu's
          content while it is closed, so the kebab's own copy of this dialog
          does not exist on page load and could not open itself. Same component,
          same props, no trigger. */}
      {sp.panel === "invoice" &&
        connectReady &&
        engagement.status !== "cancelled" && (
          <InvoiceOptionsDialog
            autoOpen
            trigger={null}
            engagementId={engagement.id}
            connectReady={connectReady}
            invoice={invoiceForOptions}
            engagementLocksDeliverables={
              engagement.invoice_locks_deliverables === true
            }
            defaultAmount={paymentPrefill}
            locale={locale}
            engagementStatus={
              engagement.status === "complete" ? "complete" : "live"
            }
            automation={{
              mode: engagement.invoice_auto_mode ?? "off",
              delayDays: engagement.invoice_delay_days ?? null,
              amountCents: engagement.invoice_amount_cents ?? null,
              description: engagement.invoice_description ?? null,
              locksDeliverables:
                engagement.invoice_locks_deliverables === true,
            }}
            builder={invoiceBuilder}
          />
        )}

      {/* The red "add a document before you can send" banner is gone with the
          rule it described. A draft is a draft whether or not it asks for
          files. */}
      {isDraft && (
        <Alert>
          <AlertDescription>{t("draft_notice")}</AlertDescription>
        </Alert>
      )}

      {/* The workflow's confirm gate, when one is waiting — the founder's tap
          that lets an automation's confirm-mode transition pass. Its own tiny
          server component so it loads nothing on the 99% of renders where no
          gate is pending. */}
      <WorkflowGateSection engagementId={engagement.id} />

      {/* Checklist + Signatures share one tab switch (Checklist is the default)
          so the page shows one section at a time instead of stacking both. Each
          tab keeps its own controls. The Activity feed lives in the Assistant
          panel's Activity tab, opened from the header. */}
      <EngagementTabs
        itemCount={engagementItems.length}
        // Rendered HERE because the page owns the data; the tab strip only
        // decides which of the three is on screen.
        servicesPanel={
          <EngagementServicesPanel
            items={engagementItems}
            locale={locale}
            schedules={billingSchedules.map((s) => ({
              id: s.id,
              frequency: s.frequency,
              nextChargeOn: s.next_charge_on,
              status: s.status,
              chargesSoFar: s.charges_so_far,
            }))}
          />
        }
        clientViewPanel={
          <EngagementClientViewPanel
            engagementId={engagement.id}
            magicToken={engagement.magic_token}
            sent={Boolean(engagement.sent_at)}
          />
        }
        // Time (1750): null keeps the tab out of the strip entirely when the
        // flag is off. Same shape as the two panels above — the page owns the
        // data, the strip only switches.
        timePanel={
          timeEnabled ? (
            <TimePanel
              entries={timeEntries.map((e) => ({
                id: e.id,
                userId: e.user_id,
                day:
                  dateInTimeZone(e.started_at, firm?.timezone ?? "UTC") ??
                  e.started_at.slice(0, 10),
                durationMinutes: e.duration_minutes,
                note: e.note,
                engagementId: e.engagement_id,
                clientId: e.client_id,
              }))}
              members={activeMembers}
              currentUserId={user?.id ?? ""}
              canManage={can(user, "time.manage")}
              locale={locale}
              context={{
                clientId: engagement.client_id,
                clientName: client?.display_name ?? null,
                engagementId: engagement.id,
              }}
            />
          ) : null
        }
        // Every task on this job, in order — ONE list, drawn by the same
        // component the firm-wide Tasks page uses. The three built-in kinds are
        // REAL rows (1370), so an engagement nobody has planned shows nothing.
        tasks={internalTasks.map((x) => ({
          id: x.id,
          title: x.title,
          kind: x.kind,
          status: x.status,
          statusId: x.statusId,
          priority: x.priority,
          assigneeIds: x.assigneeIds,
          clientId: x.clientId,
          engagementId: x.engagementId,
          notes: x.notes,
          // Drawn by DueIndicator on the row (design 2a) — the same label the
          // dashboard and /work use.
          dueDate: x.dueDate,
          // The count belongs to the collection the task POINTS AT, which only
          // this page has loaded — so it is computed here and passed down
          // rather than re-queried by the list.
          meta:
            x.kind === "document_collection"
              ? t("task_progress", {
                  done: collectionItems.filter((i) => i.status === "approved")
                    .length,
                  total: collectionItems.length,
                })
              : x.kind === "signatures"
                ? t("task_progress", {
                    done: signatureItems.filter((i) => i.status === "approved")
                      .length,
                    total: signatureItems.length,
                  })
                : x.kind === "deliverables"
                  ? t("task_count", { count: finalDocs.length })
                  : undefined,
        }))}
        members={activeMembers}
        canEdit={isLive}
        statuses={taskStatuses}
        currentUserId={user?.id ?? ""}
        // Arriving from the Tasks table's type link. Validated against the
        // job's OWN tasks rather than trusted: a stale or hand-typed id would
        // otherwise render an empty panel with a back arrow to nowhere.
        initialTaskId={
          internalTasks.some((x) => x.id === sp.task) ? (sp.task ?? null) : null
        }
        addTask={
          isLive ? (
            <AddTaskDialog
              clientId={engagement.client_id}
              engagementId={engagement.id}
              existingKinds={internalTasks.map((x) => x.kind)}
              members={activeMembers}
            />
          ) : null
        }
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
                  provider={bookkeepingProvider ?? "quickbooks"}
                />
              )}
              <ul className="space-y-2">
                {collectionItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    files={filesByItem.get(item.id) ?? []}
                    suggestionsByFile={suggestionsByFile}
                    payoutJournals={payoutJournals}
                    qboOptions={qboOptions}
                    journalAccounts={journalAccounts}
                    draftProvider={bookkeepingProvider ?? "quickbooks"}
                    reviewerNameById={reviewerNameById}
                    engagementId={id}
                    commentsEnabled={teamEnabled}
                    commentsByFile={commentsByFile}
                    commentsByItem={engagementComments.byItem}
                    mentionMembers={activeMembers}
                    currentUserId={user?.id ?? null}
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
  payoutJournals,
  qboOptions,
  journalAccounts,
  draftProvider,
  reviewerNameById,
  engagementId,
  commentsEnabled,
  commentsByFile,
  commentsByItem,
  mentionMembers,
  currentUserId,
  locale,
  canEdit,
  clientName,
  expectedYear,
  aiEnabled,
}: {
  item: RequestItem;
  files: UploadedFile[];
  // Team Wave 3 (+0930 targets): the engagement id + per-file and per-item
  // threads + @mentionable active members + the viewer, gated on team mode.
  engagementId: string;
  commentsEnabled: boolean;
  commentsByFile: Map<string, FileComment[]>;
  commentsByItem: Map<string, FileComment[]>;
  mentionMembers: { id: string; name: string }[];
  currentUserId: string | null;
  // Bookkeeping drafts keyed by uploaded file id (empty when the client isn't
  // connected to QuickBooks/Xero or the migration isn't applied).
  suggestionsByFile: Map<string, StoredDraft>;
  payoutJournals: Map<string, PayoutJournalDraft>;
  // The cached bookkeeping lists the draft cells pick from (QuickBooks or Xero).
  qboOptions: DraftCardOptions;
  // Same accounts with their type, for the payout journal's pickers.
  journalAccounts: TypedAccount[];
  // Which product this client is connected to — drives the card's branding +
  // posting gate (posting is QuickBooks-only in Phase 3).
  draftProvider: "quickbooks" | "xero";
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
              <SetSummaryLine
                assessment={item.ai_set_assessment}
                locale={locale}
                className="mt-2"
              />
            )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* The item's comment bubble, in the row's margin (Notion). Renders
              nothing until this item actually has a comment — or until the
              right-click entry asks for the composer. */}
          {commentsEnabled && (
            <CommentThread
              engagementId={engagementId}
              target={{ kind: "item", itemId: item.id }}
              initialComments={commentsByItem.get(item.id) ?? []}
              members={mentionMembers}
              currentUserId={currentUserId}
              locale={locale}
              quotedText={label}
            />
          )}
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
      commentKey={commentsEnabled ? commentKeyForItem(item.id) : undefined}
      addCommentLabel={commentsEnabled ? t("add_comment") : undefined}
    >
      {/* What the CLIENT was told, in the CLIENT's language — which is often
          not the accountant's. When a document was auto-rejected, the row below
          already explains why in the accountant's own language, so showing this
          as a full-width red alert meant reading the same sentence twice, once
          in a language the accountant may not use.
          Collapsed to a disclosure: still one click away when you need to check
          the exact wording a client received, out of the way when you don't. */}
      {hasReason && (
        <details className="group rounded-md border border-destructive/30 bg-destructive/[0.04] px-2.5 py-1.5">
          <summary className="cursor-pointer list-none text-xs font-medium text-destructive marker:hidden">
            <span className="inline-flex items-center gap-1.5">
              <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
              {t("client_was_told")}
            </span>
          </summary>
          <p className="mt-1.5 pl-4 text-xs leading-snug text-destructive/90">
            {item.rejection_reason}
          </p>
        </details>
      )}
      {hasSubmittedFiles && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <FilePreviewRow
              key={f.id}
              file={f}
              expectedDocType={item.doc_type}
              expectedYear={expectedYear}
              clientName={clientName}
              rejectionCount={item.ai_rejection_count ?? 0}
              commentable={commentsEnabled}
              commentAnchor={
                commentsEnabled ? (
                  <CommentThread
                    engagementId={engagementId}
                    target={{ kind: "file", fileId: f.id }}
                    initialComments={commentsByFile.get(f.id) ?? []}
                    members={mentionMembers}
                    currentUserId={currentUserId}
                    locale={locale}
                    quotedText={f.display_name ?? f.original_filename}
                  />
                ) : undefined
              }
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
                const showDraft =
                  d &&
                  (f.review_status === "approved" || d.status === "posted");
                // Payment-processor payout split (Stripe/Square/PayPal): shown
                // as soon as it's read, regardless of review state — it is a
                // reading of the document, not a pending action like a draft.
                const payoutCard = payoutCardData(f.ai_extracted_fields);
                // The journal half only appears for a firm with a bookkeeping
                // connection (there are no accounts to map otherwise).
                const journal = payoutJournals.get(f.id);
                // Nothing to show (no draft, no payout) → no footer. Comments
                // no longer live down here: they hang off the bubble in the
                // row's own controls.
                if (!showDraft && !payoutCard) {
                  return undefined;
                }
                return (
                  <>
                    {payoutCard && (
                      <PayoutBreakdownCard
                        data={payoutCard}
                        locale={locale}
                        // NEVER silently absent: the journal half used to
                        // vanish with no explanation when any of three
                        // conditions failed (no draft row, no bookkeeping
                        // connection, no cached accounts), which is
                        // indistinguishable from "the feature is broken".
                        // It now always renders and says which one is missing.
                        journalSlot={
                          journal ? (
                            <PayoutJournalSection
                              engagementId={engagementId}
                              uploadedFileId={f.id}
                              figures={payoutCard.figures}
                              mapping={journal.mapping}
                              status={journal.status}
                              accounts={journalAccounts}
                              locale={locale}
                              postedLink={journal.postedLink}
                              postedRef={journal.postedRef}
                              postError={journal.postError}
                              processor={payoutCard.processor}
                              periodStart={payoutCard.periodStart}
                              periodEnd={payoutCard.periodEnd}
                              payoutDate={payoutCard.payoutDate}
                              provider={journal.provider}
                            />
                          ) : (
                            <PayoutJournalUnavailable
                              reason={
                                // ItemRow knows the connection only through
                                // the account list it was handed.
                                qboOptions.accounts.length > 0
                                  ? "preparing"
                                  : "no_connection"
                              }
                              locale={locale}
                            />
                          )
                        }
                      />
                    )}
                    {showDraft && d && (
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
                        provider={draftProvider}
                      />
                    )}
                  </>
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
  // A 'pending' request that already has a SignWell document is a "place
  // anywhere" DRAFT: the accountant started the request but hasn't positioned the
  // signature field yet. They finish placement from this row; the client is not
  // notified until they do.
  const isAwaitingPlacement =
    !isSigned &&
    srStatus === "pending" &&
    Boolean(signatureRequest?.signwell_document_id);
  const statusKey = isSigned
    ? "sig_status_signed"
    : isAwaiting
      ? "sig_status_awaiting"
      : isAwaitingPlacement
        ? "sig_status_placement"
        : "sig_status_setup_needed";
  const showTestChip =
    (isAwaiting || isSigned) && signatureRequest?.test_mode === true;

  // Status-badge tint by state (green when signed, amber while awaiting the
  // client, accent while the accountant still has to place the field, neutral
  // when not set up). The card outline itself stays a plain neutral border.
  const badgeCls = isSigned
    ? "border-success/40 text-success"
    : isAwaiting
      ? "border-warning/40 text-warning"
      : isAwaitingPlacement
        ? "border-accent/40 text-accent"
        : "border-border text-muted-foreground";

  // "Setup needed" = not signed, not out, not awaiting placement. When a request
  // row exists but its SignWell setup failed, show WHY (mapped from error_detail)
  // and a Retry, so it isn't a silent dead end.
  const isSetupNeeded = !isSigned && !isAwaiting && !isAwaitingPlacement;
  const canRetrySetup = isSetupNeeded && signatureRequest != null;
  const setupReasonKey = signatureRequest?.error_detail?.includes(
    "no_signer_email",
  )
    ? "sig_setup_reason_no_email"
    : signatureRequest?.error_detail?.includes("not_configured")
      ? "sig_setup_reason_not_configured"
      : "sig_setup_reason_generic";

  // Two short-lived links to the completed PDF (with SignWell's audit page): one
  // that RENDERS inline — the "View" opens the signed PDF on its own browser tab,
  // the browser's native PDF view, not a Vylan page — and one that forces a
  // download with a readable filename. Named to avoid the module-level `viewHref`.
  let viewSignedHref: string | null = null;
  let downloadSignedHref: string | null = null;
  if (isSigned && signatureRequest?.signed_file_path) {
    try {
      // Two distinct links (the download one carries a filename), signed in
      // parallel — they used to be two sequential storage round trips.
      [viewSignedHref, downloadSignedHref] = await Promise.all([
        signedUrl(signatureRequest.signed_file_path, 3600),
        signedUrl(signatureRequest.signed_file_path, 3600, `${label}.pdf`),
      ]);
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

        {isAwaitingPlacement && canEdit && (
          <div className="border-t border-border/40 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {t("sig_placement_row_hint")}
            </p>
            <ResumeSignaturePlacement itemId={item.id} />
          </div>
        )}

        {isSetupNeeded && canEdit && (
          <div className="border-t border-border/40 px-4 py-3">
            <p className="text-sm text-muted-foreground">{t(setupReasonKey)}</p>
            {canRetrySetup && (
              <div className="mt-3">
                <RetrySignatureSetup itemId={item.id} />
              </div>
            )}
          </div>
        )}

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

// The confirm-gate loader, split out so the main render never pays for it:
// getPendingWorkflowGate short-circuits on no-workflow/flag-off engagements,
// and rendering null keeps the page byte-identical for them.
async function WorkflowGateSection({ engagementId }: { engagementId: string }) {
  const gate = await getPendingWorkflowGate(
    await getServerSupabase(),
    engagementId,
  );
  if (!gate) return null;
  return (
    <WorkflowGateCard engagementId={engagementId} from={gate.from} to={gate.to} />
  );
}
