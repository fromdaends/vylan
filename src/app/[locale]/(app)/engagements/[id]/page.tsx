import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import {
  listRelationshipsForClient,
  listRelatedClientsBrief,
} from "@/lib/db/relationships";
import { findScopeWarning } from "@/lib/relationships/validate";
import { listRequestItems } from "@/lib/db/request-items";
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
import { assertLocale } from "@/lib/locale";
import { formatDate, formatCurrency } from "@/lib/format";
import { listEngagementItems } from "@/lib/db/engagements";
import { WorkflowGateCard } from "@/components/engagements/workflow-gate-card";
import { getPendingWorkflowGate } from "@/lib/engagements/stage-sync";
import { WorkflowTimelineCard } from "@/components/engagements/workflow-timeline-card";
import { LetterPlacementCard } from "@/components/engagements/letter-placement-card";
import { parseWorkflowSnapshot } from "@/lib/workflow/definition";
import { flowSendsLetter } from "@/lib/workflow/plan";
import { buildFlowTimeline } from "@/lib/workflow/timeline";
import { listWorkflowEvents } from "@/lib/db/workflow-events";
import type { Engagement } from "@/lib/db/engagements";
import type { EngagementStage } from "@/lib/engagements/stage";
import type { AppLocale } from "@/lib/format";
import { getServerSupabase } from "@/lib/supabase/server";
// The key builders MUST come from the plain comment-keys module, NOT from
// comment-thread ("use client"): this page is a Server Component and CALLS
// them — through the client module they'd be client references, and calling
// one on the server 500s the whole page at request time (invisible to tsc
// and next build; the repo's known RSC function-prop class, cf. #796).
import {
  listCommentsForEngagement,
  groupEngagementComments,
} from "@/lib/db/file-comments";
import { EngagementPreview } from "@/components/engagements/engagement-preview/engagement-preview";
import { payoutCardData } from "@/components/engagements/payout-breakdown-card";
import {
  ensurePayoutJournalDraft,
  getPayoutJournalsForEngagement,
  type PayoutJournalDraft,
} from "@/lib/db/payout-journal";
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
import { OpenPanelOnLoad } from "@/components/assistant/open-panel-on-load";
import { InvoiceOptionsDialog } from "@/components/engagements/invoice-options-dialog";
import { AddItemDialog } from "@/components/engagements/add-item-dialog";
import { AddSignatureDialog } from "@/components/engagements/add-signature-dialog";
import { AddFinalDocumentDialog } from "@/components/engagements/add-final-document-dialog";
import { listFinalDocumentsForEngagement } from "@/lib/db/final-documents";
import { computeDeliverablesLocked } from "@/lib/portal/deliverable-access";
import { EngagementMoreMenu } from "@/components/engagements/engagement-header-actions";
import { SendReminderButton } from "@/components/engagements/send-reminder-button";
import { getRecurringSeries } from "@/lib/db/recurring";
import {
  deriveInvoiceSnapshotFromEngagement,
  parseInvoiceSnapshot,
} from "@/lib/recurring/invoice-snapshot";
import { engagementMatchesSeries } from "@/lib/recurring/sync";
import { snapshotFromRequestItems } from "@/lib/recurring/snapshot";
import { SeriesSyncPrompt } from "@/components/engagements/series-sync-prompt";
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
import { listBillableRates, valueCents } from "@/lib/db/time-billing";
import { engagementToView } from "@/lib/navigation/active-nav";
import { viewHref, viewLabelKey } from "@/lib/engagements/views";
import { normalizeReminderSettings } from "@/lib/reminder-settings";
import { computeAttention, isReadyToReview } from "@/lib/attention";
import { resolveAgreementStatus } from "@/lib/engagements/agreement";
import { hasActiveTeam } from "@/lib/team/mode";
import { listClientMembers } from "@/lib/db/client-members";
import { listEngagementMembers } from "@/lib/db/engagement-members";
import { listSubtasksByParent, listEngagementTasks } from "@/lib/db/engagement-tasks";
import { SetEngagementDetailView } from "@/components/app/active-nav-context";
import { EngagementStagePills } from "@/components/engagements/engagement-stage-pills";
import { EngagementTaskHub } from "@/components/engagements/engagement-task-hub";
import { EngagementCommentsCard } from "@/components/engagements/engagement-comments-card";
import { EngagementDetailsBox } from "@/components/engagements/engagement-details-box";
import { EngagementTeamBox } from "@/components/engagements/engagement-team-box";
import { EngagementBillingBox } from "@/components/engagements/engagement-billing-box";
import {
  Send,
  Trash2,
  CheckCircle2,
  RotateCcw,
  BellRing,
  BellOff,
  Sparkles,
  Lock,
  AlertTriangle,
  ArrowLeft,
  Eye,
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
  const collectionItems = items.filter((i) => i.kind !== "signature");

  // The flow surfaces (gate banner + timeline rail) share ONE gate lookup.
  // Both facts that decide whether a flow exists at all are already in hand
  // — the snapshot on the engagement row, the flag on the firm row — so
  // legacy and flag-off engagements never pay a single extra query, and the
  // two sections can never run the stage-fact pipeline twice per render
  // (which matters at AutoRefresh's 5s cadence). Deliberately NOT awaited
  // here: the sections await it, off the main render's critical path.
  const workflowSnapshot = parseWorkflowSnapshot(engagement.workflow);
  const workflowsOn =
    (firm as { workflows_enabled?: boolean } | null)?.workflows_enabled ===
    true;
  const flowActive =
    workflowSnapshot !== null &&
    workflowsOn &&
    engagement.status !== "cancelled";
  const gatePromise = flowActive
    ? getServerSupabase().then((sb) =>
        getPendingWorkflowGate(sb, engagement.id),
      )
    : null;

  // Time tracking (1750, reshaped by timer v2) — the Time TAB is gone; what
  // remains here is the flat-fee reality check line. Hours are firm-shared;
  // the VALUE half is computed only for viewers the billing table's RLS
  // answers (insights.view / rates.manage / their own rows), and a staff
  // member's partial read is NOT summed — a number missing colleagues' hours
  // posing as the engagement's value would be worse than no number.
  const timeEnabled = isTimeInsightsEnabled(firm);
  const canSeeTimeValue =
    can(user, "insights.view") || can(user, "rates.manage");
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
    // ── THESE THREE USED TO WAIT THEIR TURN ────────────────────────────
    // Each needs only `engagement.id` or the route param, both of which have
    // been in hand since the first batch — so each was a ~100ms round trip
    // spent queueing behind work it did not depend on. Measured against
    // production: eight of this page's reads cost 899ms strictly in series,
    // and these were three of them.
    //
    // Their DEPENDENTS still follow (billable rates need the entry ids,
    // subtasks need the task ids) — but they now start a third of a second
    // earlier, and share one round trip between them instead of two.
    engagementItems,
    timeEntries,
    internalTasks,
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
    // The priced lines. Not read until the Services panel renders (~line
    // 1550); it was fetched a thousand lines earlier, alone, for no reason
    // beyond where it happened to be written.
    listEngagementItems(engagement.id),
    // Hours logged. `timeEnabled` comes from `firm`, which the first batch
    // already resolved.
    timeEnabled
      ? listEntriesForEngagement(engagement.id)
      : Promise.resolve([]),
    // The job's own tasks. Takes the ROUTE PARAM — available before the page
    // had asked the database anything at all.
    listEngagementTasks(id),
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
  // ── THE ONE FOLLOW-UP LAYER ───────────────────────────────────────────
  // Both of these genuinely need something the batch above produced — the
  // entry ids and the task ids — so they cannot join it. They CAN share a
  // round trip with each other, which is the difference between two 100ms
  // hops and one.
  const [timeRates, subtasksByParent] = await Promise.all([
    canSeeTimeValue
      ? listBillableRates(timeEntries.map((e) => e.id))
      : Promise.resolve(new Map<string, number>()),
    listSubtasksByParent(internalTasks.map((x) => x.id)),
  ]);

  // "No rates recorded at all" is NULL, never $0 — 1780's own contract. A
  // sum that starts at 0 and finds nothing prints "$0 value" on a job that
  // may be deeply underwater, which is the exact lie the flat-fee line
  // exists to prevent.
  let timeValueCents: number | null = null;
  for (const e of timeEntries) {
    const rate = timeRates.get(e.id);
    if (rate != null) {
      timeValueCents = (timeValueCents ?? 0) + valueCents(e.duration_minutes, rate);
    }
  }
  const timeTotalMinutes = timeEntries.reduce(
    (sum, e) => sum + e.duration_minutes,
    0,
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
  // (An "is there invoice material to copy?" flag used to gate the
  // recreate-invoice switch. The switch is gone — an occurrence inherits this
  // engagement's billing either way — so only the SUMMARY sentence remains.)
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
  const view = engagementToView(engagement, { readyToReview });

  // Workflow stage (migration 0690). The stage itself is READ, never resolved
  // here — the event handlers keep it fresh (lib/engagements/stage-sync), so the
  // page just renders what's stored. undefined pre-migration, or null for a
  // draft / cancelled engagement, in which case the header keeps its status pill
  // and no stepper renders.
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
    // Whether a client was ever ASKED. When they were, nothing below
    // acceptance may infer it — see resolveAgreementStatus.
    requiresAcceptance: engagement.requires_acceptance === true,
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

  // ── DESIGN 2a DERIVATIONS ─────────────────────────────────────────────────
  // The hub + floating panel are client components; everything below flattens
  // the page's loads into the serializable rows they draw.

  const tApp = await getTranslations("App");

  // Task rows. The three structural kinds point at collections this page
  // already loaded; their row opens the matching panel. Everything else is a
  // plain row whose meta is its first line of notes.
  const hubTasks = internalTasks.map((x) => {
    const subs = subtasksByParent.get(x.id) ?? [];
    return {
      id: x.id,
      title: x.title,
      kind: x.kind as string,
      status: x.status,
      dueDate: x.dueDate,
      assigneeIds: x.assigneeIds,
      notes: x.notes ? (x.notes.split("\n")[0] ?? null) : null,
      subDone: subs.filter((s) => s.status === "done").length,
      subTotal: subs.length,
      panel:
        x.kind === "document_collection"
          ? ("docs" as const)
          : x.kind === "signatures"
            ? ("signatures" as const)
            : x.kind === "deliverables"
              ? ("deliverables" as const)
              : null,
    };
  });

  const aiEnabled = engagement.ai_enabled !== false;
  const docItems = collectionItems.map((item) => ({
    id: item.id,
    label: locale === "fr" && item.label_fr ? item.label_fr : item.label,
    status: item.status as
      | "pending"
      | "submitted"
      | "approved"
      | "rejected"
      | "na",
    files: (filesByItem.get(item.id) ?? []).map((f) => ({
      id: f.id,
      name: f.display_name ?? f.original_filename,
    })),
    rejectionReason: item.rejection_reason ?? null,
    setAssessment: aiEnabled ? (item.ai_set_assessment ?? null) : null,
  }));

  // Signature rows for the panel — the same state derivation the old
  // SignatureRow made, plus the signed copy's download link (signed here so
  // the client component receives a plain URL).
  const sigRows = await Promise.all(
    signatureItems.map(async (item) => {
      const sr = signatureRequestsByItem.get(item.id) ?? null;
      const label =
        locale === "fr" && item.label_fr ? item.label_fr : item.label;
      const srStatus = sr?.status ?? null;
      const signed = srStatus === "completed" || item.status === "approved";
      const awaiting = srStatus === "sent" || srStatus === "viewed";
      const placement =
        !signed && srStatus === "pending" && Boolean(sr?.signwell_document_id);
      const state = signed
        ? ("signed" as const)
        : awaiting
          ? ("awaiting" as const)
          : placement
            ? ("placement" as const)
            : ("setup" as const);
      let downloadHref: string | null = null;
      if (signed && sr?.signed_file_path) {
        try {
          downloadHref = await signedUrl(sr.signed_file_path, 3600, `${label}.pdf`);
        } catch {
          // Signing failed — the row simply offers no download.
        }
      }
      return {
        itemId: item.id,
        label,
        state,
        signerName: sr?.signer_name ?? null,
        signerEmail: sr?.signer_email ?? null,
        sentAt: sr?.created_at ?? null,
        viewedAt: srStatus === "viewed" ? (sr?.last_event_time ?? null) : null,
        signedAt: sr?.completed_at ?? null,
        downloadHref,
        canRetry: state === "setup" && sr != null,
        testMode: sr?.test_mode === true,
      };
    }),
  );

  const delivFiles = finalDocs.map((d) => ({
    id: d.id,
    name: d.display_name || d.original_filename,
    sizeBytes: d.size_bytes ?? null,
    uploadedAt: d.created_at ?? null,
    uploadedByName: d.uploaded_by_user_id
      ? (reviewerNameById.get(d.uploaded_by_user_id) ?? null)
      : null,
    downloadHref: finalHrefById.get(d.id) ?? null,
  }));

  // The panel's reminder hint: the first scheduled step's delay, or null when
  // reminders are off/paused (the hint then says so instead of a number).
  const reminderSettings = normalizeReminderSettings(
    engagement.reminder_settings,
  );
  const reminderEveryDays =
    reminderSettings.enabled && !engagement.reminders_paused
      ? (reminderSettings.steps[0]?.days ?? null)
      : null;

  // Team box rows — the SAME union resolveAssignees produced above, primary
  // first (resolveAssignees already orders it first).
  const teamPeople = assigneeIds
    .map((uid) => ({
      id: uid,
      name: reviewerNameById.get(uid),
      primary: uid === engagement.assigned_user_id,
    }))
    .filter((p): p is { id: string; name: string; primary: boolean } =>
      Boolean(p.name),
    );

  const repeatLabel = repeatSeries
    ? repeatSeries.frequency === "yearly"
      ? t("repeat_yearly")
      : repeatSeries.frequency === "monthly"
        ? t("repeat_monthly")
        : repeatSeries.frequency === "quarterly"
          ? t("repeat_quarterly")
          : t("repeat_badge")
    : null;

  const invoiceUnpaid = latestPayment?.status === "requested";
  const showInvoiceDialog = connectReady && engagement.status !== "cancelled";

  const outlineBtn =
    "inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-[13.5px] font-medium transition-colors duration-150 hover:bg-secondary";

  return (
    // ── IT ARRIVES, RATHER THAN APPEARING ────────────────────────────────
    //
    // The founder: "have to have an animation appear when you open an
    // engagement, it just opens instantly."
    //
    // Right, and the vocabulary for it was already here — `animate-card-in` is
    // documented in globals.css as the "Engagement page (design 2a) motion
    // vocabulary" and this page never wore it. The class was written, the page
    // shipped without it, and nobody noticed because nothing was broken; it
    // just landed with a snap.
    //
    // It matters more here than on a quiet screen: this page does real server
    // work before it can render, so the moment it finally arrives is the moment
    // you find out the click worked. A 450ms rise turns that from a jolt into
    // an arrival. `prefers-reduced-motion` drops it in globals.css.
    <div className="animate-card-in w-full">
      {/* ?panel=messages (the notifications Reply chip) opens the chat popup
          straight in Client-messages mode. */}
      {sp.panel === "messages" && <OpenPanelOnLoad tab="messages" />}
      {/* Auto-refresh while the engagement is still active. Picks up new
          client uploads + AI verdicts without requiring a reload. */}
      {isLive && <AutoRefresh intervalMs={5000} />}

      {/* Publishes this engagement's view to the sidebar so the matching
          sub-page highlights. Renders nothing. */}
      <SetEngagementDetailView view={view} />

      {/* Floating "Apply to future occurrences?" prompt — only when this
          engagement's setup actually drifted from its series. */}
      {repeatSeriesOutOfSync && repeatSeries && (
        <SeriesSyncPrompt
          seriesId={repeatSeries.id}
          engagementId={engagement.id}
        />
      )}

      {/* Billing → New invoice arrives as ?panel=invoice. Mounted at page
          level (a closed kebab menu cannot open its own dialog). */}
      {sp.panel === "invoice" && showInvoiceDialog && (
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
            locksDeliverables: engagement.invoice_locks_deliverables === true,
          }}
          builder={invoiceBuilder}
        />
      )}

      {/* ── HEADER (design 2a): breadcrumb · title row · stage pills ────── */}
      <header className="animate-card-in">
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link
            href={viewHref(view)}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {tApp("nav_engagements")}
          </Link>
          <span aria-hidden>/</span>
          <span>{t(viewLabelKey(view))}</span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em]">
            {engagement.title}
          </h1>
          {client && (
            <Link
              href={`/clients/${client.id}`}
              className="text-sm font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {client.display_name}
            </Link>
          )}
          {/* Team-mode only: who else is looking at this job right now. */}
          {teamEnabled && user && (
            <EngagementPresence
              firmId={engagement.firm_id}
              engagementId={engagement.id}
              viewerId={user.id}
              roster={activeMembers}
            />
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
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
                  /* NO documents gate — a proposal-only engagement must be
                     sendable; see sendEngagementAction. */
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
                {/* The bell — the manual reminder, unchanged component. */}
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
                {/* ACCEPTANCE (1640): each button appears only in the state it
                    belongs to. SENT, not yet agreed → record it. */}
                {agreementStatus === "sent" && (
                  <form action={acceptOnBehalfAction}>
                    <input type="hidden" name="id" value={engagement.id} />
                    <Button type="submit" size="sm" variant="outline">
                      {t("accept_on_behalf")}
                    </Button>
                  </form>
                )}
                {/* AGREED, not yet started → let the work begin. */}
                {agreementStatus === "accepted" && (
                  <form action={activateEngagementAction}>
                    <input type="hidden" name="id" value={engagement.id} />
                    <Button type="submit" size="sm">
                      {t("activate_engagement")}
                    </Button>
                  </form>
                )}
                {/* SENT or AGREED → pull it back to edit (withdraws the send
                    AND clears the acceptance — deliberately destructive). */}
                {(agreementStatus === "sent" ||
                  agreementStatus === "accepted") && (
                  <form action={revertEngagementToDraftAction}>
                    <input type="hidden" name="id" value={engagement.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      {t("revert_to_draft")}
                    </Button>
                  </form>
                )}
              </>
            )}

            {/* Client view — a DOOR to the real portal, not a preview copy
                (the whole point: the answer cannot be out of date). */}
            {engagement.sent_at && engagement.magic_token ? (
              <a
                href={`/r/${engagement.magic_token}`}
                target="_blank"
                rel="noreferrer"
                title={t("client_view_warning")}
                className={outlineBtn}
              >
                <Eye className="size-[15px]" aria-hidden />
                {t("client_view_button")}
              </a>
            ) : (
              <span
                title={t("client_view_not_sent")}
                className={`${outlineBtn} cursor-not-allowed opacity-50`}
              >
                <Eye className="size-[15px]" aria-hidden />
                {t("client_view_button")}
              </span>
            )}

            {isLive && (
              <form action={completeEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button
                  type="submit"
                  size="sm"
                  className="shadow-[0_2px_6px] shadow-accent/25"
                >
                  <CheckCircle2 className="size-4" />
                  {t("mark_complete")}
                </Button>
              </form>
            )}
            {isComplete && (
              <form action={reopenEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button type="submit" variant="outline" size="sm">
                  <RotateCcw className="size-4" />
                  {t("reopen")}
                </Button>
              </form>
            )}

            {/* The "..." menu: reminders, invoice, links, downloads, access,
                privacy, cancellation, deletion. Unchanged. */}
            {!isDraft && (
              <EngagementMoreMenu
                engagementId={engagement.id}
                locale={locale}
                commentable={teamEnabled}
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
                repeatInvoiceSummary={repeatInvoiceSummary}
                repeatSeriesOutOfSync={repeatSeriesOutOfSync}
                status={isLive ? "live" : isComplete ? "complete" : "cancelled"}
                remindersPaused={engagement.reminders_paused}
                reminderSettings={reminderSettings}
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
        </div>

        {/* Labeled stage pills — passed stages collapsed (replaces the dot
            stepper; same resolver + words as the engagements list). */}
        <EngagementStagePills
          status={agreementStatus}
          // Only draw an Accepted pill where acceptance is part of this
          // engagement's life — asked for, or already given. Otherwise the
          // rail ticks a stage nobody was ever asked to pass.
          showAccepted={
            engagement.requires_acceptance === true ||
            engagement.accepted_at != null
          }
        />

        {/* The exceptions, kept: rare states the founder must still see. */}
        {(engagement.reminders_paused ||
          engagement.ai_enabled === false ||
          (user?.role === "owner" && engagement.is_private && !isDraft)) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
            {engagement.reminders_paused && (
              <Badge variant="outline" className="text-xs">
                <BellOff className="size-3" />
                {t("reminders_paused_badge")}
              </Badge>
            )}
            {engagement.ai_enabled === false && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                <Sparkles className="size-3" />
                {t("ai_off_badge")}
              </Badge>
            )}
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
        )}

        {/* Recipient safety: every send goes to the client record's email —
            warn (never block) when its owner's scopes don't cover this work. */}
        {scopeWarningText && (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {scopeWarningText}
          </p>
        )}
      </header>

      {/* ── BODY: [work | rail] ─────────────────────────────────────────── */}
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_316px]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* The workflow's confirm gate, when one is waiting. */}
          <WorkflowGateSection
            engagementId={engagement.id}
            gatePromise={gatePromise}
          />
          {/* The letter draft awaiting field placement, when one is. */}
          <LetterPlacementSection engagementId={engagement.id} />

          {isDraft && (
            <Alert>
              <AlertDescription>{t("draft_notice")}</AlertDescription>
            </Alert>
          )}

          <div
            className="animate-card-in"
            style={{ animationDelay: "60ms" }}
          >
            <EngagementTaskHub
              engagementId={engagement.id}
              tasks={hubTasks}
              items={docItems}
              signatures={sigRows}
              deliverables={delivFiles}
              deliverablesLocked={deliverablesLocked}
              invoiceNumber={latestPayment?.invoice_number ?? null}
              clientName={client?.display_name ?? null}
              portalUrl={
                engagement.magic_token ? `/r/${engagement.magic_token}` : null
              }
              reminderEveryDays={reminderEveryDays}
              members={activeMembers}
              canEdit={isLive}
              locale={locale}
              addTask={
                isLive ? (
                  // ⚠️ NO custom trigger element here on purpose. A trigger
                  // node built in this Server Component and threaded through
                  // the client hub into PopoverTrigger rendered NOTHING —
                  // silently, on SSR and client alike (build of 2026-08-07;
                  // the panel dialogs with their own triggers were fine). The
                  // dialog's own accent button is also the SAME control /work
                  // shows, which the cohesion rule prefers anyway.
                  <AddTaskDialog
                    clientId={engagement.client_id}
                    engagementId={engagement.id}
                    existingKinds={internalTasks.map((x) => x.kind)}
                    members={activeMembers}
                  />
                ) : null
              }
              addDeliverable={
                engagement.status !== "cancelled" ? (
                  <AddFinalDocumentDialog
                    engagementId={engagement.id}
                    trigger={
                      <button
                        type="button"
                        className="w-full cursor-pointer rounded-xl border-[1.5px] border-dashed border-border px-4 py-4 text-center text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-accent/50 hover:text-accent"
                      >
                        {t("deliv_dropzone")}
                      </button>
                    }
                  />
                ) : null
              }
              preview={
                <EngagementPreview
                  uploads={uploads}
                  items={items}
                  engagementId={engagement.id}
                  engagementTitle={engagement.title}
                  clientName={client?.display_name ?? null}
                  locale={locale}
                />
              }
              addItem={
                isLive ? (
                  <AddItemDialog
                    engagementId={engagement.id}
                    province={client?.province ?? null}
                  />
                ) : null
              }
              addSignature={
                isLive ? (
                  <AddSignatureDialog engagementId={engagement.id} />
                ) : null
              }
            />
          </div>

          {teamEnabled && (
            <EngagementCommentsCard
              engagementId={engagement.id}
              initialComments={engagementComments.engagement}
              members={activeMembers}
              currentUserId={user?.id ?? null}
              locale={locale}
              quotedText={engagement.title}
              autoFocus={sp.comment === "1"}
              className="animate-card-in"
              style={{ animationDelay: "140ms" }}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <EngagementDetailsBox
            locale={locale}
            client={
              client ? { id: client.id, name: client.display_name } : null
            }
            relationshipLine={relHeaderLine}
            services={engagementItems.map((i) => i.name).filter(Boolean)}
            sentAt={engagement.sent_at ?? null}
            acceptedAt={engagement.accepted_at ?? null}
            dueDate={engagement.due_date ?? null}
            repeatLabel={repeatLabel}
            style={{ animationDelay: "100ms" }}
          />

          {/* The flow's timeline — what fired, where the job is, what's
              next. Renders nothing for legacy/flag-off engagements (the
              null gatePromise), and costs them zero queries. */}
          {flowActive && workflowSnapshot && gatePromise && (
            <WorkflowTimelineSection
              engagement={engagement}
              wf={workflowSnapshot}
              gatePromise={gatePromise}
              hasProposalItems={engagementItems.length > 0}
              locale={locale}
              // reviewerNameById, not activeMembers: "handed to X" is
              // history, and history keeps the names of people who left.
              memberNames={Object.fromEntries(reviewerNameById)}
            />
          )}

          {(teamEnabled || teamPeople.length > 0) && (
            <EngagementTeamBox
              people={teamPeople}
              control={
                teamEnabled ? (
                  <EngagementAssigneesControl
                    engagementId={engagement.id}
                    assigneeIds={assigneeIds}
                    primaryId={engagement.assigned_user_id}
                    members={activeMembers}
                    canEdit={teamEnabled}
                  />
                ) : null
              }
              handoff={handoff}
              access={
                canGrantJobAccess && jobGuests.length > 0 ? (
                  <EngagementAccess
                    engagementId={id}
                    guests={jobGuests}
                    candidates={jobCandidates}
                  />
                ) : null
              }
              style={{ animationDelay: "160ms" }}
            />
          )}

          <EngagementBillingBox
            locale={locale}
            invoice={
              latestPayment
                ? {
                    status: latestPayment.status,
                    amountCents: latestPayment.amount_cents,
                    number: latestPayment.invoice_number ?? null,
                    requestedAt: latestPayment.created_at ?? null,
                    paidAt: latestPayment.paid_at ?? null,
                  }
                : null
            }
            viewInvoice={
              showInvoiceDialog ? (
                <InvoiceOptionsDialog
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
                  trigger={
                    <button
                      type="button"
                      className="cursor-pointer text-xs font-medium text-accent transition-colors hover:text-accent-hover"
                    >
                      {latestPayment
                        ? t("billing_view_invoice")
                        : t("billing_create_invoice")}{" "}
                      →
                    </button>
                  }
                />
              ) : null
            }
            remind={
              invoiceUnpaid && isLive && !trialLocked ? (
                <SendReminderButton engagementId={engagement.id} />
              ) : null
            }
            canceledChip={
              latestPayment?.status === "canceled" &&
              paymentStatusLabel &&
              showCanceledChip &&
              invoiceCanceledAt ? (
                <PaymentCanceledChip
                  canceledAt={invoiceCanceledAt}
                  label={paymentStatusLabel}
                  amountLabel={formatCurrency(
                    latestPayment.amount_cents / 100,
                    locale,
                  )}
                />
              ) : null
            }
            time={
              timeEnabled
                ? {
                    minutes: timeTotalMinutes,
                    valueCents: canSeeTimeValue ? timeValueCents : null,
                  }
                : null
            }
            style={{ animationDelay: "220ms" }}
          />
        </div>
      </div>
    </div>
  );
}

// The flow-timeline loader, the gate section's twin. The page already
// established the flow exists (snapshot parsed, flag on, not cancelled) and
// shares ONE gate lookup between both sections — all this pays for itself is
// the ledger read.
async function WorkflowTimelineSection({
  engagement,
  wf,
  gatePromise,
  hasProposalItems,
  locale,
  memberNames,
}: {
  engagement: Engagement;
  wf: NonNullable<ReturnType<typeof parseWorkflowSnapshot>>;
  gatePromise: Promise<{ from: EngagementStage; to: EngagementStage } | null>;
  hasProposalItems: boolean;
  locale: AppLocale;
  memberNames: Record<string, string>;
}) {
  const sb = await getServerSupabase();
  const [events, gate, letterRes] = await Promise.all([
    listWorkflowEvents(sb, engagement.id),
    gatePromise,
    // The letter's LIVE status — the ledger only knows the effect ran, not
    // whether an editor-mode draft is still awaiting field placement.
    // Tolerant of pre-1580 (no letter_key column): reads as no letter.
    sb
      .from("signature_requests")
      .select("status")
      .eq("engagement_id", engagement.id)
      .not("letter_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const timeline = buildFlowTimeline(
    wf,
    {
      status: engagement.status,
      stage: engagement.stage ?? null,
      sentAt: engagement.sent_at ?? null,
      acceptedAt: engagement.accepted_at ?? null,
      hasProposalItems,
      pendingGateStage: gate?.from ?? null,
      letterLiveStatus: letterRes.error
        ? null
        : ((letterRes.data?.[0] as { status?: string } | undefined)?.status ??
          null),
      events,
    },
    { flowSendsLetter: flowSendsLetter(wf) },
  );

  return (
    <WorkflowTimelineCard
      timeline={timeline}
      locale={locale}
      memberNames={memberNames}
      style={{ animationDelay: "130ms" }}
    />
  );
}

// The pending editor-mode letter, when one exists: the accountant must
// finish placing its signature fields before the client can sign — and the
// portal blocks acceptance until then, so this card is the only way forward.
// Null on any read hiccup or pre-1580 (no letter_key): nothing renders.
async function LetterPlacementSection({
  engagementId,
}: {
  engagementId: string;
}) {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("signature_requests")
    .select("request_item_id, status, signwell_document_id")
    .eq("engagement_id", engagementId)
    .not("letter_key", "is", null)
    .eq("status", "pending")
    .not("signwell_document_id", "is", null)
    .limit(1);
  const row = (data?.[0] ?? null) as { request_item_id: string | null } | null;
  if (error || !row?.request_item_id) return null;
  return <LetterPlacementCard itemId={row.request_item_id} />;
}

// The confirm-gate loader, split out so the main render never pays for it:
// the shared promise is null for legacy/flag-off engagements, and rendering
// null keeps the page byte-identical for them.
async function WorkflowGateSection({
  engagementId,
  gatePromise,
}: {
  engagementId: string;
  gatePromise: Promise<{ from: EngagementStage; to: EngagementStage } | null> | null;
}) {
  const gate = gatePromise ? await gatePromise : null;
  if (!gate) return null;
  return (
    <WorkflowGateCard engagementId={engagementId} from={gate.from} to={gate.to} />
  );
}
