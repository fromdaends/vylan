"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  BellOff,
  Check,
  Download,
  Link as LinkIcon,
  Loader2,
  MoreHorizontal,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDownloadAll } from "./use-download-all";
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
  cancelEngagementAction,
  deleteEngagementAction,
  toggleRemindersPausedAction,
} from "@/app/actions/engagements";

// The "..." overflow menu for an engagement's occasional actions: copying
// links, reminder controls, downloads, cancellation, and deletion. Activity
// remains available in the Assistant and is intentionally absent here.
export function EngagementMoreMenu({
  engagementId,
  locale,
  status,
  remindersPaused,
  hasUploads,
  canDelete,
  clientLinkToken,
  paymentLinkUrl,
}: {
  engagementId: string;
  locale: "fr" | "en";
  status: "live" | "complete" | "cancelled";
  remindersPaused: boolean;
  hasUploads: boolean;
  canDelete: boolean;
  // Live engagements only: enables "Copy client link" (origin-aware portal URL).
  clientLinkToken?: string;
  // Present when a payment has been requested: enables "Copy payment link".
  paymentLinkUrl?: string;
}) {
  const t = useTranslations("Engagements");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState<null | "client" | "payment">(null);

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

  const togglePause = () => {
    const f = new FormData();
    f.set("id", engagementId);
    // toggleRemindersPausedAction reads "paused": "1" pauses, "0" resumes.
    f.set("paused", remindersPaused ? "0" : "1");
    void toggleRemindersPausedAction(f);
  };

  const cancel = () => {
    const f = new FormData();
    f.set("id", engagementId);
    void cancelEngagementAction(f);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("more_actions")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
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

          {(isLive || hasUploads) && <DropdownMenuSeparator />}
          {isLive && (
            <DropdownMenuItem onSelect={togglePause}>
              {remindersPaused ? <Bell /> : <BellOff />}
              {remindersPaused ? t("resume_reminders") : t("pause_reminders")}
            </DropdownMenuItem>
          )}
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
          {isLive && (
            <DropdownMenuItem onSelect={cancel}>
              <X />
              {t("cancel")}
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
