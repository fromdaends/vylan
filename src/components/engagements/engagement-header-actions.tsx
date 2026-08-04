"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { EngagementAccessDialog } from "@/components/engagements/engagement-access-dialog";
import { toast } from "sonner";
import {
  Bell,
  Check,
  Download,
  FolderUp,
  Link as LinkIcon,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  Repeat,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useDownloadAll } from "./use-download-all";
import {
  InvoiceOptionsDialog,
  type EngagementInvoiceAutomation,
  type InvoiceForOptions,
} from "./invoice-options-dialog";
import type { InvoiceBuilderConfig } from "./invoice-builder";
import { ReminderAutomationDialog } from "./reminder-automation-dialog";
import { FileToStorageDialog } from "@/components/filing/file-to-storage-dialog";
import {
  RepeatDialog,
  type EngagementRepeatInfo,
} from "./repeat-dialog";
import type { ReminderSettings } from "@/lib/reminder-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteEngagementAction,
  setEngagementPrivacyAction,
} from "@/app/actions/engagements";
import { commentKeyForEngagement } from "@/components/engagements/comment-thread";
import { useCommentFromMenu } from "@/components/engagements/use-comment-from-menu";

// The "..." overflow menu for an engagement's occasional actions: copying
// links, reminder controls, downloads, and deletion. Activity remains
// available in the Assistant and is intentionally absent here. (Cancel was
// dropped — Delete covers removing an engagement.)
export function EngagementMoreMenu({
  engagementId,
  locale,
  status,
  remindersPaused,
  reminderSettings,
  hasUploads,
  canDelete,
  clientLinkToken,
  connectReady,
  invoice,
  engagementLocksDeliverables,
  invoiceDefaultAmount,
  invoiceAutomation,
  invoiceBuilder,
  repeatSeries,
  repeatInvoiceAvailable,
  repeatInvoiceSummary,
  repeatSeriesOutOfSync,
  privacy,
  commentable,
  access,
}: {
  engagementId: string;
  // NOTE: clientId used to be a prop here, solely to deep-link the Activity
  // item at the firm audit log. That item is gone, and nothing else in this
  // menu needed the client — so the prop went with it rather than lingering as
  // a parameter no one reads.
  locale: "fr" | "en";
  status: "live" | "complete" | "cancelled";
  remindersPaused: boolean;
  reminderSettings: ReminderSettings;
  hasUploads: boolean;
  canDelete: boolean;
  // Live engagements only: enables "Copy client link" (origin-aware portal URL).
  clientLinkToken?: string;
  // Invoice management (create / edit / lock-unlock / waive) lives in the "..."
  // menu now instead of the header row.
  connectReady?: boolean;
  invoice?: InvoiceForOptions | null;
  engagementLocksDeliverables?: boolean;
  invoiceDefaultAmount?: string;
  invoiceAutomation: EngagementInvoiceAutomation;
  // Firm invoice settings + Default-prices presets for the Generate builder.
  invoiceBuilder: InvoiceBuilderConfig;
  // Recurring series (migration 0770): the engagement's series, null when it
  // isn't in one. Powers the Repeat menu entry + dialog.
  repeatSeries?: EngagementRepeatInfo | null;
  // Invoice recurrence (Phase 4): switch gating + the stored-snapshot summary.
  repeatInvoiceAvailable?: boolean;
  repeatInvoiceSummary?: string | null;
  // Whether this engagement's setup differs from its series (edit-future box
  // gating).
  repeatSeriesOutOfSync?: boolean;
  // Owner-only "Private to me" override (Team Wave 4). Absent for staff / solo
  // firms → the menu item isn't shown.
  privacy?: { isOwner: boolean; isPrivate: boolean };
  // Team mode: "Add a comment" opens the engagement-level comment composer
  // under the page header (same thread the worklist right-click deep-links to).
  commentable?: boolean;
  /**
   * Per-job access — "let someone see just this job".
   *
   * Absent (a solo firm, or a viewer who cannot grant) and the item is not
   * shown. It lives here rather than under the page title because the founder
   * is right that it is a rare deliberate act, not a daily control.
   */
  access?: {
    guests: { id: string; name: string }[];
    candidates: { id: string; name: string }[];
  };
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState<null | "client">(null);
  const [pendingPrivacy, startPrivacy] = useTransition();
  const [isPrivate, setIsPrivate] = useState(privacy?.isPrivate ?? false);

  // "Add a comment" opens the engagement's comment card, but only once this
  // menu has finished closing — see useCommentFromMenu for why doing it in
  // onSelect made the card flash open and disappear.
  const comment = useCommentFromMenu();

  const togglePrivacy = () => {
    if (pendingPrivacy) return;
    const next = !isPrivate;
    setIsPrivate(next); // optimistic
    startPrivacy(async () => {
      const res = await setEngagementPrivacyAction(engagementId, next);
      if (res.ok) {
        router.refresh();
      } else {
        setIsPrivate(!next); // revert
        toast.error(
          res.error === "unavailable"
            ? t("privacy_unavailable")
            : t("privacy_failed"),
        );
      }
    });
  };

  const copy = async (which: "client", url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked — no-op (the user can re-open the menu and retry).
    }
  };

  // Shared with the Preview overlay's "Download all" — one code path so they
  // can't drift (the route returns JSON {url}; the browser downloads).
  const { downloading, downloadAll } = useDownloadAll(engagementId);
  const isLive = status === "live";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-muted"
            aria-label={t("more_actions")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64"
          onCloseAutoFocus={comment.onCloseAutoFocus}
        >
          {privacy?.isOwner && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  togglePrivacy();
                }}
                disabled={pendingPrivacy}
              >
                {isPrivate ? <LockOpen /> : <Lock />}
                {isPrivate ? t("make_public") : t("make_private")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {access && (
            <EngagementAccessDialog
              engagementId={engagementId}
              guests={access.guests}
              candidates={access.candidates}
              trigger={
                // preventDefault, or Radix closes the menu and unmounts the
                // dialog with it before it can open. Same shape as
                // ReminderAutomationDialog below.
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <UserPlus />
                  {t("access_menu")}
                </DropdownMenuItem>
              }
            />
          )}
          {commentable && (
            <DropdownMenuItem
              onSelect={() =>
                comment.request(commentKeyForEngagement(engagementId))
              }
            >
              <MessageSquare />
              {t("add_comment")}
            </DropdownMenuItem>
          )}
          {isLive && (
            <ReminderAutomationDialog
              engagementId={engagementId}
              initialSettings={reminderSettings}
              initiallyPaused={remindersPaused}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Bell />
                  {t("reminder_menu")}
                </DropdownMenuItem>
              }
            />
          )}
          {status !== "cancelled" && (
            <RepeatDialog
              engagementId={engagementId}
              locale={locale}
              series={repeatSeries ?? null}
              invoiceAvailable={repeatInvoiceAvailable === true}
              invoiceSummary={repeatInvoiceSummary ?? null}
              seriesOutOfSync={repeatSeriesOutOfSync === true}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Repeat />
                  {t("repeat_menu")}
                </DropdownMenuItem>
              }
            />
          )}
          {status !== "cancelled" &&
            (connectReady ||
              !!invoice ||
              engagementLocksDeliverables === true) && (
            <InvoiceOptionsDialog
              engagementId={engagementId}
              connectReady={connectReady === true}
              invoice={invoice ?? null}
              engagementLocksDeliverables={engagementLocksDeliverables === true}
              defaultAmount={invoiceDefaultAmount ?? ""}
              locale={locale}
              engagementStatus={status}
              automation={invoiceAutomation}
              builder={invoiceBuilder}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Receipt />
                  {t("invoice_menu")}
                </DropdownMenuItem>
              }
            />
          )}
          {clientLinkToken && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  // Keep the menu open so the "Copied" feedback is visible.
                  e.preventDefault();
                  void copy(
                    "client",
                    `${window.location.origin}/r/${clientLinkToken}`,
                  );
                }}
              >
                {copied === "client" ? <Check /> : <LinkIcon />}
                {copied === "client" ? t("copied") : t("copy_client_link")}
              </DropdownMenuItem>
              <div className="px-2 pb-1.5 pt-0.5 text-xs leading-snug text-muted-foreground">
                {t("magic_link_hint")}
              </div>
            </>
          )}
          {/* REMOVED (founder): "Copy payment link". It copied the SAME portal
              URL "Copy client link" already gives you — a payment is paid on
              the portal, so there was never a separate payment address. Two
              menu entries producing one identical string is noise. */}

          {/* File to storage — the on-demand filing run (Document filing).
              Shown whenever the engagement is live-ish; the dialog itself
              explains not-connected / nothing-approved states. */}
          {status !== "cancelled" && (
            <FileToStorageDialog
              engagementId={engagementId}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <FolderUp />
                  {t("file_to_storage_menu")}
                </DropdownMenuItem>
              }
            />
          )}
          {hasUploads && <DropdownMenuSeparator />}
          {hasUploads && (
            <DropdownMenuItem
              // Keep the menu from closing-and-cancelling: run the blob
              // download instead of navigating an anchor.
              onSelect={(e) => {
                e.preventDefault();
                void downloadAll();
              }}
              disabled={downloading}
            >
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
              {t("download_all")}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmOpen(true)}
              >
                <Trash2 />
                {t("delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirmation — controlled, opened by the Delete menu item.
          Confirm submits the server action via a real form so its
          redirect-to-dashboard fires (same flow as the old delete button). */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete_title")}</DialogTitle>
            <DialogDescription>{t("delete_desc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("delete_cancel")}
              </Button>
            </DialogClose>
            <form action={deleteEngagementAction}>
              <input type="hidden" name="id" value={engagementId} />
              <input type="hidden" name="__app_locale" value={locale} />
              <Button type="submit" variant="destructive">
                <Trash2 className="size-4" />
                {t("delete_confirm")}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
