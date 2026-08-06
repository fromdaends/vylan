"use client";

// THE FLOATING TASK PANEL (design 2a) — what opens when a task row with a
// linked artifact is clicked. One dialog, three bodies:
//
//   docs         → the request items, each with Approve / Changes / Nudge and
//                  its uploaded-file chips. Approve is optimistic and reports
//                  back to the hub (onApproved) so the task row's meta line
//                  moves behind the panel. "Changes" opens the SAME
//                  RejectModal the file rows use — one reject flow, one
//                  reason dialog, wherever it is asked for.
//   signatures   → one bordered row per signature item, status from the
//                  SignWell request (audit line from its timestamps), with
//                  Download / Resend / Copy signing link / placement + setup
//                  recovery — the same client components the old Signatures
//                  tab mounted.
//   deliverables → the lock-until-paid banner (page-computed, same rule the
//                  portal enforces), the final documents, and the add
//                  drop-zone (the existing upload dialog behind it).
//
// Built on the Radix dialog primitives rather than ui/dialog's DialogContent:
// the panel is TOP-ALIGNED with its own overlay tint, entrance (modal-in) and
// shadow, and DialogContent's centering + zoom animations would have to be
// fought class-by-class to get there.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { toast } from "sonner";
import {
  Bell,
  Check,
  Clock,
  Download,
  FileText,
  Link2,
  Lock,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate, type AppLocale } from "@/lib/format";
import { approveItemAction } from "@/app/actions/items";
import { sendReminderAction } from "@/app/actions/engagements";
import { RejectModal } from "@/components/engagements/reject-modal";
import { ResumeSignaturePlacement } from "@/components/engagements/resume-signature-placement";
import { RetrySignatureSetup } from "@/components/engagements/retry-signature-setup";
import { FinalDocumentDelete } from "@/components/engagements/final-document-row";

export type ArtifactPanelKind = "docs" | "signatures" | "deliverables";

export type DocPanelItem = {
  id: string;
  label: string;
  status: "pending" | "submitted" | "approved" | "rejected" | "na";
  files: { id: string; name: string }[];
};

export type SigPanelRow = {
  itemId: string;
  label: string;
  state: "signed" | "awaiting" | "placement" | "setup";
  signerName: string | null;
  signerEmail: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  downloadHref: string | null;
  canRetry: boolean;
  testMode: boolean;
};

export type DelivPanelFile = {
  id: string;
  name: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
  uploadedByName: string | null;
  downloadHref: string | null;
};

const ROW = "rounded-xl border border-border/80 px-3.5 py-3";
const ACTION_BTN =
  "inline-flex h-[27px] flex-none cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors duration-150 hover:bg-secondary disabled:cursor-default disabled:opacity-50";
const FOOTER_BTN =
  "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-medium transition-colors duration-150 hover:bg-secondary disabled:cursor-default disabled:opacity-50";

function StatusPill({
  tone,
  children,
}: {
  tone: "waiting" | "review" | "approved" | "rejected" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium",
        tone === "waiting" && "bg-warning/[0.13] text-warning",
        tone === "review" && "bg-accent/10 text-accent",
        tone === "approved" && "bg-success/[0.12] text-success",
        tone === "rejected" && "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-secondary text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className="inline-block size-1.5 rounded-full bg-current"
      />
      {children}
    </span>
  );
}

function IconTile({
  tone,
  children,
}: {
  tone: "waiting" | "review" | "approved" | "rejected" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex size-8 flex-none items-center justify-center rounded-lg",
        tone === "waiting" && "bg-warning/[0.13] text-warning",
        tone === "review" && "bg-accent/10 text-accent",
        tone === "approved" && "bg-success/[0.12] text-success",
        tone === "rejected" && "bg-destructive/10 text-destructive",
        tone === "accent" && "bg-accent/10 text-accent",
      )}
    >
      {children}
    </div>
  );
}

function formatSize(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaskArtifactPanel({
  kind,
  onClose,
  engagementId,
  title,
  items,
  onApproved,
  signatures,
  deliverables,
  deliverablesLocked,
  invoiceNumber,
  clientName,
  portalUrl,
  reminderEveryDays,
  canEdit,
  locale,
  addDeliverable,
  reviewDocuments,
}: {
  kind: ArtifactPanelKind | null;
  onClose: () => void;
  engagementId: string;
  title: string;
  items: DocPanelItem[];
  onApproved: (itemId: string) => void;
  signatures: SigPanelRow[];
  deliverables: DelivPanelFile[];
  deliverablesLocked: boolean;
  invoiceNumber: string | null;
  clientName: string | null;
  portalUrl: string | null;
  reminderEveryDays: number | null;
  canEdit: boolean;
  locale: AppLocale;
  addDeliverable: React.ReactNode;
  reviewDocuments: React.ReactNode;
}) {
  const t = useTranslations("Engagements");
  const tStatus = useTranslations("Status");
  const router = useRouter();
  const [pendingNudge, startNudge] = useTransition();
  const [, startApprove] = useTransition();
  const [rejectItem, setRejectItem] = useState<DocPanelItem | null>(null);

  function nudge() {
    if (pendingNudge) return;
    startNudge(async () => {
      const fd = new FormData();
      fd.set("id", engagementId);
      try {
        const res = await sendReminderAction(fd);
        if (res.ok) toast.success(t("reminder_sent"));
        else toast.error(t("reminder_failed"));
      } catch {
        toast.error(t("reminder_failed"));
      }
    });
  }

  function approve(item: DocPanelItem) {
    onApproved(item.id);
    startApprove(async () => {
      const fd = new FormData();
      fd.set("id", item.id);
      try {
        await approveItemAction(fd);
        router.refresh();
      } catch {
        toast.error(t("panel_approve_failed"));
        router.refresh();
      }
    });
  }

  function copySigningLink() {
    if (!portalUrl) return;
    void navigator.clipboard
      .writeText(portalUrl)
      .then(() => toast.success(t("panel_link_copied")))
      .catch(() => toast.error(t("panel_link_copy_failed")));
  }

  const counted = items.filter((i) => i.status !== "na");
  const approved = counted.filter((i) => i.status === "approved").length;
  const pct =
    counted.length > 0 ? Math.round((approved / counted.length) * 100) : 0;

  const meta =
    kind === "docs"
      ? [
          clientName,
          reminderEveryDays != null
            ? t("panel_reminder_days", { days: reminderEveryDays })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : kind === "signatures"
        ? [clientName, signatures.some((s) => s.testMode) ? t("sig_test_mode") : null]
            .filter(Boolean)
            .join(" · ")
        : kind === "deliverables"
          ? deliverablesLocked && invoiceNumber
            ? t("deliv_panel_locked_meta", { number: invoiceNumber })
            : deliverablesLocked
              ? t("deliv_meta_locked")
              : t("deliv_panel_unlocked_meta")
          : "";

  return (
    <DialogPrimitive.Root
      open={kind != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/35 animate-in-fade" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-4 top-[max(env(safe-area-inset-top),6vh)] z-50 mx-auto max-h-[86dvh] w-auto overflow-y-auto rounded-2xl bg-card shadow-panel animate-modal-in focus-visible:outline-none",
            // The document request is the working panel — a review queue, not
            // a status card — so it takes more room (founder request): wider,
            // and pulled up so its list gets the height.
            kind === "docs"
              ? "max-w-[860px] sm:top-16 sm:max-h-[calc(100dvh-104px)]"
              : "max-w-[640px] sm:top-[110px] sm:max-h-[calc(100dvh-150px)]",
          )}
          aria-describedby={undefined}
        >
          <div className="px-[22px] pt-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {kind === "docs"
                  ? t("kind_document_collection")
                  : kind === "signatures"
                    ? t("kind_signatures")
                    : t("kind_deliverables")}
              </span>
              <DialogPrimitive.Close
                aria-label={t("panel_close")}
                className="ml-auto flex size-[30px] cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-[15px]" aria-hidden />
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Title className="mt-2.5 text-lg font-semibold tracking-[-0.015em]">
              {title}
            </DialogPrimitive.Title>
            {meta && (
              <p className="mt-[3px] text-[12.5px] text-muted-foreground">
                {meta}
              </p>
            )}
          </div>

          {/* ── Document request ─────────────────────────────────────────── */}
          {kind === "docs" && (
            <div className="px-[22px] pb-5 pt-3.5">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("docs_meta_approved", {
                    done: approved,
                    total: counted.length,
                  })}
                </span>
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-success transition-[width] duration-[350ms] ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {items.map((item) => {
                  const tone =
                    item.status === "pending"
                      ? ("waiting" as const)
                      : item.status === "submitted"
                        ? ("review" as const)
                        : item.status === "approved"
                          ? ("approved" as const)
                          : item.status === "rejected"
                            ? ("rejected" as const)
                            : ("muted" as const);
                  return (
                    <div key={item.id} className={ROW}>
                      <div className="flex items-center gap-2.5">
                        <IconTile tone={tone === "muted" ? "waiting" : tone}>
                          <FileText className="size-[15px]" aria-hidden />
                        </IconTile>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-medium">
                            {item.label}
                          </div>
                          <div className="mt-px truncate text-[11.5px] text-muted-foreground">
                            {item.files.length > 0
                              ? t("panel_files_count", {
                                  count: item.files.length,
                                })
                              : t("panel_no_files_yet")}
                          </div>
                        </div>
                        <StatusPill tone={tone}>
                          {item.status === "pending"
                            ? t("item_waiting")
                            : item.status === "submitted"
                              ? t("item_review")
                              : item.status === "approved"
                                ? t("item_approved")
                                : item.status === "rejected"
                                  ? t("item_changes")
                                  : tStatus("na")}
                        </StatusPill>
                        {canEdit && item.status === "submitted" && (
                          <div className="flex flex-none gap-1.5">
                            <button
                              type="button"
                              onClick={() => approve(item)}
                              className="inline-flex h-[27px] cursor-pointer items-center gap-1.5 rounded-lg bg-success/[0.12] px-2.5 text-xs font-medium text-success transition-colors duration-150 hover:bg-success/20"
                            >
                              <Check
                                className="size-[11px]"
                                strokeWidth={2.5}
                                aria-hidden
                              />
                              {t("approve")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejectItem(item)}
                              className={cn(
                                ACTION_BTN,
                                "text-muted-foreground hover:border-destructive/40 hover:bg-transparent hover:text-destructive",
                              )}
                            >
                              {t("panel_changes")}
                            </button>
                          </div>
                        )}
                        {canEdit && item.status === "pending" && (
                          <button
                            type="button"
                            onClick={nudge}
                            disabled={pendingNudge}
                            className={ACTION_BTN}
                          >
                            {t("panel_nudge")}
                          </button>
                        )}
                      </div>
                      {item.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 pl-[38px]">
                          {item.files.map((f) => (
                            <a
                              key={f.id}
                              href={`/api/files/${f.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-[11.5px] font-medium transition-colors duration-150 hover:border-accent/40 hover:text-accent"
                            >
                              <FileText className="size-[11px]" aria-hidden />
                              {f.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3.5 flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3.5">
                {canEdit && (
                  <button
                    type="button"
                    onClick={nudge}
                    disabled={pendingNudge}
                    className={FOOTER_BTN}
                  >
                    <Bell className="size-3" aria-hidden />
                    {t("panel_nudge_client")}
                  </button>
                )}
                <span onClick={(e) => e.stopPropagation()}>
                  {reviewDocuments}
                </span>
                <span className="text-xs text-muted-foreground">
                  {reminderEveryDays != null
                    ? t("panel_reminder_days", { days: reminderEveryDays })
                    : t("panel_reminder_off")}
                </span>
              </div>
            </div>
          )}

          {/* ── Signatures ───────────────────────────────────────────────── */}
          {kind === "signatures" && (
            <div className="flex flex-col gap-2.5 px-[22px] pb-5 pt-3.5">
              {signatures.map((s) => {
                const audit = [
                  s.sentAt
                    ? t("panel_sig_sent", {
                        date: formatDate(s.sentAt, locale, "compact"),
                      })
                    : null,
                  s.viewedAt
                    ? t("panel_sig_viewed", {
                        date: formatDate(s.viewedAt, locale, "compact"),
                      })
                    : null,
                  s.signedAt
                    ? t("panel_sig_signed", {
                        date: formatDate(s.signedAt, locale, "compact"),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const toLine =
                  s.state !== "signed" && (s.signerName || s.signerEmail)
                    ? t("panel_sig_sent_to", {
                        who: [s.signerName, s.signerEmail]
                          .filter(Boolean)
                          .join(" · "),
                      })
                    : null;
                return (
                  <div key={s.itemId} className={cn(ROW, "px-4 py-3")}>
                    <div className="flex items-center gap-3">
                      <IconTile
                        tone={
                          s.state === "signed"
                            ? "approved"
                            : s.state === "awaiting"
                              ? "waiting"
                              : "accent"
                        }
                      >
                        {s.state === "signed" ? (
                          <Check className="size-4" aria-hidden />
                        ) : (
                          <Clock className="size-4" aria-hidden />
                        )}
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">
                          {s.label}
                        </div>
                        <div className="mt-px truncate text-[11.5px] text-muted-foreground">
                          {audit || toLine || t("panel_sig_not_sent")}
                        </div>
                      </div>
                      <StatusPill
                        tone={
                          s.state === "signed"
                            ? "approved"
                            : s.state === "awaiting"
                              ? "waiting"
                              : s.state === "placement"
                                ? "review"
                                : "muted"
                        }
                      >
                        {s.state === "signed"
                          ? t("sig_status_signed")
                          : s.state === "awaiting"
                            ? t("sig_status_awaiting")
                            : s.state === "placement"
                              ? t("sig_status_placement")
                              : t("sig_status_setup_needed")}
                      </StatusPill>
                      {s.state === "signed" && s.downloadHref && (
                        <a
                          href={s.downloadHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={ACTION_BTN}
                        >
                          <Download className="size-3" aria-hidden />
                          {t("final_download")}
                        </a>
                      )}
                    </div>
                    {s.state === "awaiting" && canEdit && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
                        <button
                          type="button"
                          onClick={nudge}
                          disabled={pendingNudge}
                          className={FOOTER_BTN}
                        >
                          {t("panel_sig_resend")}
                        </button>
                        {portalUrl && (
                          <button
                            type="button"
                            onClick={copySigningLink}
                            className={FOOTER_BTN}
                          >
                            <Link2 className="size-3" aria-hidden />
                            {t("panel_sig_copy_link")}
                          </button>
                        )}
                        {toLine && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {toLine}
                          </span>
                        )}
                      </div>
                    )}
                    {s.state === "placement" && canEdit && (
                      <div className="mt-2.5 border-t border-border/60 pt-2.5">
                        <p className="text-xs text-muted-foreground">
                          {t("sig_placement_row_hint")}
                        </p>
                        <div className="mt-2">
                          <ResumeSignaturePlacement itemId={s.itemId} />
                        </div>
                      </div>
                    )}
                    {s.state === "setup" && canEdit && s.canRetry && (
                      <div className="mt-2.5 border-t border-border/60 pt-2.5">
                        <RetrySignatureSetup itemId={s.itemId} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Deliverable ──────────────────────────────────────────────── */}
          {kind === "deliverables" && (
            <div className="px-[22px] pb-5 pt-3.5">
              {deliverablesLocked && (
                <div className="flex items-center gap-2.5 rounded-[10px] border border-border/80 bg-secondary/60 px-3.5 py-2.5 text-[12.5px] text-foreground/70">
                  <Lock className="size-3.5 flex-none" aria-hidden />
                  {invoiceNumber
                    ? t("deliv_locked_banner", { number: invoiceNumber })
                    : t("deliv_locked_banner_no_number")}
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                {deliverables.map((d) => {
                  const ext = d.name.includes(".")
                    ? d.name.split(".").pop()!.slice(0, 4).toUpperCase()
                    : "DOC";
                  const metaLine = [
                    formatSize(d.sizeBytes),
                    d.uploadedAt
                      ? d.uploadedByName
                        ? t("deliv_uploaded_by", {
                            date: formatDate(d.uploadedAt, locale, "compact"),
                            name: d.uploadedByName,
                          })
                        : t("deliv_uploaded", {
                            date: formatDate(d.uploadedAt, locale, "compact"),
                          })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div
                      key={d.id}
                      className={cn(
                        ROW,
                        "mt-2.5 flex items-center gap-3 px-4 py-3",
                      )}
                    >
                      <div className="flex size-8 flex-none items-center justify-center rounded-lg bg-accent/10 text-[9px] font-bold text-accent">
                        {ext}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">
                          {d.name}
                        </div>
                        {metaLine && (
                          <div className="mt-px truncate text-[11.5px] text-muted-foreground">
                            {metaLine}
                          </div>
                        )}
                      </div>
                      {d.downloadHref && (
                        <a
                          href={d.downloadHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={ACTION_BTN}
                        >
                          {t("final_download")}
                        </a>
                      )}
                      {canEdit && (
                        <FinalDocumentDelete
                          id={d.id}
                          engagementId={engagementId}
                          filename={d.name}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {canEdit && <div className="mt-2.5">{addDeliverable}</div>}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {/* One reject flow for the whole product: the same modal the file rows
          use, opened item-level here (no fileId → the whole line). */}
      {rejectItem && (
        <RejectModal
          itemId={rejectItem.id}
          itemLabel={rejectItem.label}
          hideTrigger
          open={rejectItem != null}
          onOpenChange={(o) => {
            if (!o) setRejectItem(null);
          }}
        />
      )}
    </DialogPrimitive.Root>
  );
}
