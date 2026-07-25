"use client";

// Owner-only "Reset stats" control for the Performance header.
//
// No reset active → a subtle "Reset stats" button that opens a confirmation
// dialog (the reset changes what the whole firm sees, so it confirms first).
// Reset active → a muted "Stats reset on <date>" note that EVERYONE sees (it
// explains why the numbers look fresh); only owners get the one-click "Show all
// history" undo. Both the reset and the undo are non-destructive — they just
// move a timestamp — so undo needs no confirmation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { formatDate, type AppLocale } from "@/lib/format";
import type { PerfCopy } from "./copy";
import {
  resetPerformanceStats,
  undoPerformanceReset,
  type PerfResetResult,
} from "@/app/actions/performance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ResetStats({
  resetAt,
  isOwner,
  locale,
  copy,
}: {
  resetAt: string | null;
  isOwner: boolean;
  locale: AppLocale;
  copy: PerfCopy["reset"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (
    action: () => Promise<PerfResetResult>,
    successMsg: string,
  ) => {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(successMsg);
        setOpen(false);
        router.refresh();
      } else if (res.error === "unavailable") {
        toast.error(copy.unavailable);
      } else {
        toast.error(copy.failed);
      }
    });
  };

  // Reset active: the note is shown to everyone; the undo is owner-only.
  if (resetAt) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{copy.active(formatDate(resetAt, locale, "medium"))}</span>
        {isOwner && (
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0 text-xs"
            disabled={pending}
            onClick={() => run(undoPerformanceReset, copy.undone)}
          >
            {copy.undo}
          </Button>
        )}
      </div>
    );
  }

  // No reset: only owners can start one.
  if (!isOwner) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <RotateCcw className="size-3.5" />
          {copy.action}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.dialogTitle}</DialogTitle>
          <DialogDescription>{copy.dialogBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={pending}
            onClick={() => run(resetPerformanceStats, copy.done)}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
