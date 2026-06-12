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
import { approveFileAction } from "@/app/actions/files";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
import { MagicLinkPanel } from "@/components/engagements/magic-link-panel";
import { FilePreviewRow } from "@/components/engagements/file-preview-row";
import { ChecklistItemShell } from "@/components/engagements/checklist-item-shell";
import { EngagementPreview } from "@/components/engagements/engagement-preview/engagement-preview";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import { RejectModal } from "@/components/engagements/reject-modal";
import { ActivityTimeline } from "@/components/engagements/activity-timeline";
import { AddItemDialog } from "@/components/engagements/add-item-dialog";
import { AddSignatureDialog } from "@/components/engagements/add-signature-dialog";
import { signedUrl } from "@/lib/storage";
import { EngagementMoreMenu } from "@/components/engagements/engagement-header-actions";
import { EngagementAssignee } from "@/components/engagements/engagement-assignee";
import { RecordEngagementOpen } from "@/components/engagements/record-engagement-open";
import { AutoRefresh } from "@/components/engagements/auto-refresh";
import { DemoBlockButton } from "@/components/app/demo-block-modal";
import { getCurrentFirm } from "@/lib/db/firms";
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
  Check,
  CheckCircle2,
  RotateCcw,
  Bell,
  BellOff,
  Download,
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

  const t = await getTranslations("Engagements");
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
      {/* Record this open (per device) so the dashboard's "Jump back in"
          card can surface it. Renders nothing. */}
      <RecordEngagementOpen engagementId={engagement.id} />

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
          {isComplete && (
            <form action={reopenEngagementAction}>
              <input type="hidden" name="id" value={engagement.id} />
              <Button type="submit" variant="outline" size="sm">
                <RotateCcw className="size-4" />
                {t("reopen")}
              </Button>
            </form>
          )}
          {/* Occasional actions (Pause/Resume reminders, Download all, Cancel,
              Delete) live in a "..." menu so the header stays calm — primary +
              secondary visible, the rest one tap away. Delete keeps its
              confirmation + 30-day recovery. Drafts keep their own inline
              Send + Delete-draft buttons above and never get this menu. */}
          {!isDraft && (
            <EngagementMoreMenu
              engagementId={engagement.id}
              locale={locale}
              status={isLive ? "live" : isComplete ? "complete" : "cancelled"}
              remindersPaused={engagement.reminders_paused}
              hasUploads={uploads.length > 0}
              canDelete={canDelete}
            />
          )}
        </div>
      </header>

      {portalUrl && isLive && <MagicLinkPanel url={portalUrl} />}

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

      {/* On a wide monitor (>=1800px) the Activity rail becomes a fixed 360px
          column instead of a proportional third (which would balloon to ~670px);
          the checklist column takes the rest. Below 1800px it's the original
          3-column proportional grid, unchanged. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-[1800px]:grid-cols-[minmax(0,1fr)_360px]">
        <section className="lg:col-span-2 space-y-4 min-[1800px]:col-span-1">
          {/* Signatures first: a signature (an authorization or engagement
              letter) is usually a quick, important action, so it sits above the
              longer document checklist rather than buried beneath it. */}
          {(isLive || signatureItems.length > 0) && (
            <div className="space-y-3">
              <div className="flex flex-row items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  {t("signatures")}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({signatureItems.length})
                  </span>
                </h2>
                {isLive && <AddSignatureDialog engagementId={engagement.id} />}
              </div>
              {signatureItems.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">
                  {t("signatures_empty")}
                </div>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {signatureItems.map((item) => (
                    <SignatureRow
                      key={item.id}
                      item={item}
                      files={filesByItem.get(item.id) ?? []}
                      locale={locale}
                      canEdit={isLive}
                      clientName={client?.display_name ?? null}
                      engagementTitle={engagement.title}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-row items-center justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                {t("checklist")}{" "}
                <span className="text-muted-foreground font-normal">
                  ({collectionItems.length})
                </span>
              </h2>
              <div className="flex items-center gap-2">
                {/* Always-available visual review of every uploaded document,
                    regardless of how many there are. */}
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
              </div>
            </div>
            {collectionItems.length === 0 ? (
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
                    engagementTitle={engagement.title}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-4">
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
        </aside>
      </div>
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
  engagementTitle,
}: {
  item: RequestItem;
  files: (UploadedFile & { url: string })[];
  locale: "fr" | "en";
  canEdit: boolean;
  clientName: string | null;
  expectedYear: number | null;
  engagementTitle: string;
}) {
  const t = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const label =
    locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const hasSubmittedFiles = files.length > 0;
  const hasReason = item.status === "rejected" && !!item.rejection_reason;
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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasSubmittedFiles && (
            <EngagementPreview
              variant="item"
              uploads={files}
              items={[item]}
              engagementId={item.engagement_id}
              engagementTitle={engagementTitle}
              clientName={clientName}
              locale={locale}
            />
          )}
          <Badge variant={itemBadgeVariant(item.status)}>
            {tStatus(item.status)}
          </Badge>
          {item.status === "submitted" && canEdit && (
            <>
              <form action={approveItemAction}>
                <input type="hidden" name="id" value={item.id} />
                {/* Hover effect: flip to the success-green palette + a
                    soft tinted shadow so the positive action reads as
                    a clear "confirm" cue, not just a default primary
                    button. The base button's `transition-all` +
                    `active:scale-[0.97]` already supply the press
                    feedback. */}
                <Button
                  type="submit"
                  size="sm"
                  className="hover:bg-success hover:text-white hover:shadow-md hover:shadow-success/30 focus-visible:ring-success/40"
                >
                  <CheckCircle2 className="size-4" />
                  {t("approve")}
                </Button>
              </form>
              <RejectModal itemId={item.id} itemLabel={label} />
            </>
          )}
          {item.status === "rejected" && canEdit && (
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
            />
          ))}
        </ul>
      )}
    </ChecklistItemShell>
  );
}

// Prompt B: a signature item rendered for the accountant. Same machinery as a
// collection item, relabelled: "Sent to client" -> "Signed copy returned" ->
// "Signed". Confirm = approve the returned copy. No legal / e-signature claims.
async function SignatureRow({
  item,
  files,
  locale,
  canEdit,
  clientName,
}: {
  item: RequestItem;
  files: (UploadedFile & { url: string })[];
  locale: "fr" | "en";
  canEdit: boolean;
  clientName: string | null;
  engagementTitle: string;
}) {
  const t = await getTranslations("Engagements");
  const label = locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const hasReturned = files.length > 0;
  // Short-lived link for the accountant to re-open the blank document they
  // uploaded to be signed.
  let signingDocUrl: string | null = null;
  if (item.signing_doc_path) {
    try {
      signingDocUrl = await signedUrl(item.signing_doc_path, 3600);
    } catch {
      signingDocUrl = null;
    }
  }

  return (
    <li className="py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{label}</div>
          {signingDocUrl && (
            <a
              href={signingDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="size-3.5" />
              {t("view_document_to_sign")}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={itemBadgeVariant(item.status)}>
            {t(signatureStatusKey(item.status))}
          </Badge>
          {/* Approve / reject is per signed copy (the icons on each file row
              below), so a client who sends several copies can have some accepted
              and others sent back — no single "confirm all". */}
          {canEdit &&
            !hasReturned &&
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

      {item.status === "rejected" && item.rejection_reason && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            <span className="font-medium">{t("rejection_reason")}: </span>
            {item.rejection_reason}
          </AlertDescription>
        </Alert>
      )}

      {files.length > 0 && (
        <ul className="space-y-1 mt-2">
          {files.map((f) => (
            <FilePreviewRow
              key={f.id}
              file={f}
              url={f.url}
              expectedDocType={item.doc_type}
              expectedYear={null}
              clientName={clientName}
              rejectionCount={item.ai_rejection_count ?? 0}
              hideAi
              actions={
                canEdit ? (
                  <>
                    {/* Approve this copy. Filled green once approved. */}
                    <form action={approveFileAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("approve")}
                        title={t("approve")}
                        className={
                          f.review_status === "approved"
                            ? "bg-success text-white hover:bg-success/90"
                            : "text-muted-foreground hover:bg-success/10 hover:text-success"
                        }
                      >
                        <Check className="size-4" />
                      </Button>
                    </form>
                    {/* Send this copy back with a reason. Filled red once sent
                        back. Rejects just this file, not the whole signature. */}
                    <RejectModal
                      itemId={item.id}
                      itemLabel={f.original_filename}
                      fileId={f.id}
                      compact
                      active={f.review_status === "rejected"}
                      suggestions={[
                        t("sig_reject_not_signed"),
                        t("sig_reject_wrong_doc"),
                        t("sig_reject_unclear"),
                      ]}
                    />
                  </>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function signatureStatusKey(status: string): string {
  switch (status) {
    case "approved":
      return "sig_status_signed";
    case "submitted":
      return "sig_status_returned";
    case "rejected":
      return "sig_status_rejected";
    default:
      return "sig_status_sent"; // pending / na / fallback
  }
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
