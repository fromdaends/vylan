"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff, Download, MoreHorizontal, Trash2, X } from "lucide-react";
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
            <DropdownMenuItem asChild>
              <a href={`/api/engagements/${engagementId}/files.zip`} download>
                <Download />
                {t("download_all")}
              </a>
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
