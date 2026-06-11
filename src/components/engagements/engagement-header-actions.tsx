"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bell, BellOff, Download, Loader2, MoreHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

// The "..." overflow menu for an engagement's header actions. The primary +
// secondary actions (Mark complete / Send reminder / Reopen) stay as visible
// buttons in the header; the occasional ones live here so the bar stays calm:
//   * live      → Pause/Resume reminders, Download all, Cancel, Delete
//   * complete  → Download all, Delete
//   * cancelled → Download all, Delete
// Delete keeps its confirmation + soft-delete (recoverable 30 days). The menu
// self-hides when it would be empty (e.g. a staff member on a cancelled
// engagement with no uploads), so we never show a dead "..." button.
export function EngagementMoreMenu({
  engagementId,
  locale,
  status,
  remindersPaused,
  hasUploads,
  canDelete,
}: {
  engagementId: string;
  locale: "fr" | "en";
  status: "live" | "complete" | "cancelled";
  remindersPaused: boolean;
  hasUploads: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("Engagements");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Download-all used to be a plain <a download> inside the dropdown item. The
  // menu closes on click, which UNMOUNTS the anchor before the browser starts
  // the download — Safari then cancels it (the "does nothing" bug). Fetch the
  // ZIP as a blob and save it programmatically instead, so it survives the menu
  // closing and we can surface a real error (no files / network) as a toast.
  // Works identically on macOS Safari/Chrome and Windows.
  async function downloadAll() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/files.zip`);
      if (!res.ok) {
        toast.error(
          res.status === 404 ? t("download_all_empty") : t("download_all_failed"),
        );
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      const filename = match?.[1] ?? "documents.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the click has been handed to the browser.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t("download_all_failed"));
    } finally {
      setDownloading(false);
    }
  }

  const isLive = status === "live";
  const hasItems = isLive || hasUploads || canDelete;
  if (!hasItems) return null;

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
        <DropdownMenuContent align="end" className="w-52">
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
              {(isLive || hasUploads) && <DropdownMenuSeparator />}
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
