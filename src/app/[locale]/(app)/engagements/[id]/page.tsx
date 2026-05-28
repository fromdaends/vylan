import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import { listRequestItems, type RequestItem } from "@/lib/db/request-items";
import {
  listUploadedFilesForEngagement,
  signedDownloadUrl,
  type UploadedFile,
} from "@/lib/db/uploaded-files";
import { listActivityForEngagement } from "@/lib/db/activity";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  sendEngagementAction,
  cancelEngagementAction,
  completeEngagementAction,
  reopenEngagementAction,
  sendReminderAction,
  deleteDraftAction,
  toggleRemindersPausedAction,
} from "@/app/actions/engagements";
import {
  approveItemAction,
  reopenItemAction,
  removeItemAction,
} from "@/app/actions/items";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
import { MagicLinkPanel } from "@/components/engagements/magic-link-panel";
import { FilePreviewRow } from "@/components/engagements/file-preview-row";
import { RejectModal } from "@/components/engagements/reject-modal";
import { ActivityTimeline } from "@/components/engagements/activity-timeline";
import { AddItemDialog } from "@/components/engagements/add-item-dialog";
import { AutoRefresh } from "@/components/engagements/auto-refresh";
import { DemoBlockButton } from "@/components/app/demo-block-modal";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  ArrowLeft,
  Send,
  X,
  Trash2,
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

  const engagement = await getEngagement(id);
  if (!engagement) notFound();
  const [client, items, uploads, activity, firm] = await Promise.all([
    getClient(engagement.client_id),
    listRequestItems(engagement.id),
    listUploadedFilesForEngagement(engagement.id),
    listActivityForEngagement(engagement.id),
    getCurrentFirm(),
  ]);
  const isDemo = firm?.is_demo === true;

  // Pre-sign URLs (15 min) for every upload.
  const filesByItem = new Map<string, (UploadedFile & { url: string })[]>();
  await Promise.all(
    uploads.map(async (u) => {
      const url = await signedDownloadUrl(u.storage_path, 900).catch(
        () => "#",
      );
      const arr = filesByItem.get(u.request_item_id) ?? [];
      arr.push({ ...u, url });
      filesByItem.set(u.request_item_id, arr);
    }),
  );

  const t = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");

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
      {/* Auto-refresh while the engagement is still active. Picks up new
          client uploads + AI verdicts + activity-log entries without
          requiring the accountant to hit reload. Skipped for draft /
          complete / cancelled engagements since nothing changes there. */}
      {isLive && <AutoRefresh intervalMs={5000} />}

      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-3.5" />
        {t("back")}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3 animate-in-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {engagement.title}
          </h1>
          <div className="flex items-center gap-2 mt-2.5 text-sm flex-wrap">
            <Badge variant={statusVariant(engagement.status)}>
              {tStatus(engagement.status)}
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
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && (
            <>
              {isDemo ? (
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
              <form action={deleteDraftAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <input type="hidden" name="__app_locale" value={locale} />
                <Button type="submit" variant="outline" size="sm">
                  <Trash2 className="size-4" />
                  {t("delete_draft")}
                </Button>
              </form>
            </>
          )}
          {isLive && (
            <>
              {isDemo ? (
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
              <form action={toggleRemindersPausedAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <input
                  type="hidden"
                  name="paused"
                  value={engagement.reminders_paused ? "0" : "1"}
                />
                <Button type="submit" variant="outline" size="sm">
                  {engagement.reminders_paused ? (
                    <>
                      <Bell className="size-4" />
                      {t("resume_reminders")}
                    </>
                  ) : (
                    <>
                      <BellOff className="size-4" />
                      {t("pause_reminders")}
                    </>
                  )}
                </Button>
              </form>
              <form action={completeEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                {/* Success-tinted hover — matches the per-item Approve
                    button (PR #156) so positive / confirm actions read
                    consistently across the app. */}
                <Button
                  type="submit"
                  size="sm"
                  className="hover:bg-success hover:text-white hover:shadow-md hover:shadow-success/30 focus-visible:ring-success/40"
                >
                  <CheckCircle2 className="size-4" />
                  {t("mark_complete")}
                </Button>
              </form>
              <form action={cancelEngagementAction}>
                <input type="hidden" name="id" value={engagement.id} />
                <Button type="submit" variant="ghost" size="sm">
                  <X className="size-4" />
                  {t("cancel")}
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
          {/* Bulk download of every uploaded file for this engagement.
              Disabled in draft (nothing's been requested yet) or when
              no files have actually been uploaded — the route would
              404 anyway. */}
          {uploads.length > 0 && (
            <a
              href={`/api/engagements/${engagement.id}/files.zip`}
              className="inline-flex"
              // The native <a download> hint asks the browser to save
              // rather than navigate. Server's Content-Disposition
              // sets the actual filename.
              download
            >
              <Button type="button" variant="outline" size="sm">
                <Download className="size-4" />
                {t("download_all")}
              </Button>
            </a>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {t("checklist")}{" "}
                <span className="text-muted-foreground font-normal">
                  ({items.length})
                </span>
              </CardTitle>
              {isLive && <AddItemDialog engagementId={engagement.id} />}
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">
                  {t("checklist_empty")}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      files={filesByItem.get(item.id) ?? []}
                      locale={locale}
                      canEdit={isLive}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
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
}: {
  item: RequestItem;
  files: (UploadedFile & { url: string })[];
  locale: "fr" | "en";
  canEdit: boolean;
}) {
  const t = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const label =
    locale === "fr" && item.label_fr ? item.label_fr : item.label;
  const hasSubmittedFiles = files.length > 0;

  return (
    <li className="py-3 space-y-2">
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
              rejectionCount={item.ai_rejection_count ?? 0}
            />
          ))}
        </ul>
      )}
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
