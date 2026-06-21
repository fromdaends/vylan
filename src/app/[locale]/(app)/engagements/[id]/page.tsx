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
import { listActivityForEngagement } from "@/lib/db/activity";
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
import { EngagementPreview } from "@/components/engagements/engagement-preview/engagement-preview";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { RejectModal } from "@/components/engagements/reject-modal";
import { ActivityTimeline } from "@/components/engagements/activity-timeline";
import { ActivityDrawer } from "@/components/engagements/activity-drawer";
import { AddItemDialog } from "@/components/engagements/add-item-dialog";
import { AddSignatureDialog } from "@/components/engagements/add-signature-dialog";
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
import { RequestPaymentButton } from "@/components/engagements/request-payment-button";
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
} from "lucide-react";

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Items / uploads / activity all key off the URL `id` (= engagement.id), so
  // they don't need to wait for getEngagement — run the whole lot in ONE
  // parallel batch. The uploads branch also batch-signs every download URL in a
  // single storage round-trip (was N separate calls, the biggest chunk of this
  // page's load). Only the client lookup (needs engagement.client_id) waits.
  const [engagement, items, uploadData, activity, firm, user, firmUsers] =
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
      listActivityForEngagement(id),
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

  // Assignment (Phase 5): resolve the assignee (may be deactivated — still shown
  // for history) + the active members available as reassignment targets.
  const assignee =
    firmUsers.find((u) => u.id === engagement.assigned_user_id) ?? null;
  const activeMembers = firmUsers
    .filter((u) => !u.deactivated_at)
    .map((u) => ({ id: u.id, name: userDisplayLabel(u) }));

  const filesByItem = new Map<string, (UploadedFile & { url: string })[]>();
  for (const u of uploads) {
    const arr = filesByItem.get(u.request_item_id) ?? [];
    arr.push({ ...u, url: urlByPath.get(u.storage_path) ?? "#" });
    filesByItem.set(u.request_item_id, arr);
  }

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

  // The Activity feed, rendered once and shown either inside the 3-dots menu's
  // slide-out (non-drafts) or the standalone Activity icon (drafts).
  const activityFeed = (
    <ActivityTimeline
      entries={activity}
      locale={locale}
      filenamesByFileId={
        new Map(uploads.map((u) => [u.id, u.original_filename]))
      }
      rejectionReasonsByItemId={
        new Map(items.map((i) => [i.id, i.rejection_reason ?? null]))
      }
    />
  );

  return (
    <div className="space-y-6">
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
                · {t("due", { date: formatDate(engagement.due_date, locale, "medium") })}
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
              <Badge variant="outline" className="text-xs text-muted-foreground">
                <Sparkles className="size-3" />
                {t("ai_off_badge")}
              </Badge>
            )}
          </div>
          {/* Assigned to — accountability control (reassign to any active member). */}
          <div className="mt-3">
            <EngagementAssignee
              engagementId={engagement.id}
              assigneeId={engagement.assigned_user_id}
              assigneeName={assignee ? userDisplayLabel(assignee) : null}
              assigneeDeactivated={!!assignee?.deactivated_at}
              members={activeMembers}
            />
          </div>
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
                />
              ) : (
                <form action={sendReminderAction}>
                  <input type="hidden" name="id" value={engagement.id} />
                  <Button type="submit" variant="outline" size="sm">
                    <Bell className="size-4" />
                    {t("send_reminder")}
                  </Button>
                </form>
              )}
              {/* Mark complete — the clear primary action. Success-tinted hover
                  matches the per-item Approve button (PR #156) so confirm
                  actions read consistently across the app. */}
              <form action={completeEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button
                  type="submit"
                  size="sm"
                  className="hover:bg-success hover:text-white hover:shadow-md hover:shadow-success/30 focus-visible:ring-success/40"
                >
                  <CheckCircle2 className="size-4" />
                  {t("mark_complete")}
                </Button>
              </form>
            </>
          )}
          {latestPayment && paymentStatusLabel && (
            <Badge
              variant={
                latestPayment.status === "paid"
                  ? "default"
                  : latestPayment.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
            >
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
              {connectReady && (
                <RequestPaymentButton
                  engagementId={engagement.id}
                  defaultAmount={paymentPrefill}
                />
              )}
            </>
          )}
          {/* Activity: drafts keep a standalone slide-out icon; every other
              state opens it from the "..." menu, so the row stays calm. */}
          {isDraft && <ActivityDrawer>{activityFeed}</ActivityDrawer>}
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
              activity={activityFeed}
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
          tab keeps its own controls. The Activity feed opens from the header
          slide-out. */}
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
            <ul className="space-y-2">
              {collectionItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  files={filesByItem.get(item.id) ?? []}
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
          )
        }
        signatures={
          signatureItems.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {t("signatures_empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
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
      />
    </div>
  );
}

async function ItemRow({
  item,
  files,
  locale,
  canEdit,
  clientName,
  expectedYear,
  aiEnabled,
}: {
  item: RequestItem;
  files: (UploadedFile & { url: string })[];
  locale: "fr" | "en";
  canEdit: boolean;
  clientName: string | null;
  expectedYear: number | null;
  // When false, AI is off for this engagement — hide all per-document AI chrome.
  aiEnabled: boolean;
}) {
  const t = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const label =
    locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const hasSubmittedFiles = files.length > 0;
  const hasReason = item.status === "rejected" && !!item.rejection_reason;
  // A missing-page block reads as "rejected" in the roll-up but isn't a file
  // rejection — relabel the badge and offer approve/reject instead of reopen.
  const missingPageBlock = isMissingPageBlock(item);
  // Collapsible only when there's something to reveal. Items needing the
  // accountant's eye (submitted = awaiting review, rejected = shows the reason)
  // start open; resolved/empty items start collapsed so a long list stays calm.
  const hasBody = hasSubmittedFiles || hasReason;
  const defaultOpen =
    item.status === "submitted" || item.status === "rejected";

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
                className="mt-1.5"
              />
            )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {missingPageBlock ? (
            <Badge
              variant="outline"
              className="border-warning/40 text-warning"
            >
              {t("set_incomplete_badge")}
            </Badge>
          ) : item.status === "rejected" ? (
            // A document under this item was sent back — the line isn't
            // "rejected/closed", it's waiting on the client to resend. Soft
            // amber, not a hard red "Rejected".
            <Badge
              variant="outline"
              className="border-warning/40 text-warning"
            >
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
              {/* Hover effect: flip to the success-green palette + a soft tinted
                  shadow so the positive action reads as a clear "confirm" cue. */}
              <Button
                type="submit"
                size="sm"
                className="hover:bg-success hover:text-white hover:shadow-md hover:shadow-success/30 focus-visible:ring-success/40"
              >
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
              // can't be rejected — it already doesn't count. The X turns red
              // once a document has been sent back.
              actions={
                canEdit && !f.is_duplicate ? (
                  <RejectModal
                    itemId={item.id}
                    itemLabel={f.display_name ?? f.original_filename}
                    fileId={f.id}
                    compact
                    active={f.review_status === "rejected"}
                  />
                ) : undefined
              }
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
  const badgeVariant = isSigned
    ? "default"
    : isAwaiting
      ? "secondary"
      : "outline";
  const showTestChip =
    (isAwaiting || isSigned) && signatureRequest?.test_mode === true;

  // Short-lived download link to the signed PDF (with SignWell's audit page)
  // once it has been pulled back. Forces a download with a readable filename.
  let signedHref: string | null = null;
  if (isSigned && signatureRequest?.signed_file_path) {
    try {
      signedHref = await signedUrl(
        signatureRequest.signed_file_path,
        3600,
        `${label}.pdf`,
      );
    } catch {
      signedHref = null;
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t(statusKey)}</span>
            {showTestChip && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("sig_test_mode")}
              </span>
            )}
          </div>
          {signedHref && (
            <a
              href={signedHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="size-3.5" />
              {t("sig_download_signed")}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={badgeVariant}>{t(statusKey)}</Badge>
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
