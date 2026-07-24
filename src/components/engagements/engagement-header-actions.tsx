"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Bell,
  Check,
  Download,
  History,
  Link as LinkIcon,
  Loader2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Receipt,
  Repeat,
  Trash2,
  Wallet,
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

// The "..." overflow menu for an engagement's occasional actions: copying
// links, reminder controls, downloads, and deletion. Activity remains
// available in the Assistant and is intentionally absent here. (Cancel was
// dropped — Delete covers removing an engagement.)
export function EngagementMoreMenu({
  engagementId,
  clientId,
  isOwner,
  locale,
  status,
  remindersPaused,
  reminderSettings,
  hasUploads,
  canDelete,
  clientLinkToken,
  paymentLinkUrl,
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
}: {
  engagementId: string;
  // The engagement's client id — the Activity item deep-links to the firm
  // audit log pre-filtered to this client.
  clientId: string;
  // Firm owner? The Activity item targets the owner-only audit log, so it's
  // hidden from staff (who would otherwise hit a 404).
  isOwner: boolean;
  locale: "fr" | "en";
  status: "live" | "complete" | "cancelled";
  remindersPaused: boolean;
  reminderSettings: ReminderSettings;
  hasUploads: boolean;
  canDelete: boolean;
  // Live engagements only: enables "Copy client link" (origin-aware portal URL).
  clientLinkToken?: string;
  // Present when a payment has been requested: enables "Copy payment link".
  paymentLinkUrl?: string;
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
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState<null | "client" | "payment">(null);
  const [pendingPrivacy, startPrivacy] = useTransition();
  const [isPrivate, setIsPrivate] = useState(privacy?.isPrivate ?? false);

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

  const copy = async (which: "client" | "payment", url: string) => {
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
        <DropdownMenuContent align="end" className="w-64">
          {/* Activity → the owner-only firm audit log, pre-filtered to this
              engagement's client (Activity moved out of the old assistant
              panel). Owner-gated: staff can't open the audit log. */}
          {isOwner && (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  router.push(
                    `/settings/audit?client=${encodeURIComponent(clientId)}`,
                  );
                }}
              >
                <History />
                {t("activity_menu")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
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
          {paymentLinkUrl && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void copy("payment", paymentLinkUrl);
              }}
            >
              {copied === "payment" ? <Check /> : <Wallet />}
              {copied === "payment" ? t("copied") : t("copy_payment_link")}
            </DropdownMenuItem>
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
