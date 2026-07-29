"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { handOverWorkAction } from "@/app/actions/team";

// "Hand over everything" — the bulk assign. Lives on a teammate's profile,
// which is the one screen that already shows the whole plate you are moving.
//
// Why this shape rather than tick-boxes on the work list: the app has no
// row-selection anywhere, so multi-select would be a new system, and the case
// that actually comes up is not "these four" — it is "all of Priya's work,
// she's on leave until August". Until now the ONLY way to move work in bulk was
// to REMOVE the person, because the bulk move lived inside offboarding.
//
// Owner-only (the action re-checks; this just doesn't render for staff). The
// dialog states the exact counts before anything moves, because this is the one
// control here that changes many rows at once.
export function HandOverWork({
  fromUserId,
  fromName,
  members,
  counts,
}: {
  fromUserId: string;
  fromName: string;
  // Active teammates other than this person.
  members: { id: string; name: string }[];
  // What will move, so the confirm can say so plainly.
  counts: { engagements: number; clients: number };
}) {
  const t = useTranslations("Team");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [pending, startTransition] = useTransition();

  // Nothing to move, or nobody to move it to.
  const nothingToMove = counts.engagements === 0 && counts.clients === 0;
  if (members.length === 0 || nothingToMove) return null;

  function submit() {
    if (!toId) return;
    const to = members.find((m) => m.id === toId);
    startTransition(async () => {
      const res = await handOverWorkAction(fromUserId, toId);
      if (res.ok) {
        setOpen(false);
        setToId("");
        toast(
          t("handover_done", {
            name: to?.name ?? "",
            engagements: res.engagements,
            clients: res.clients,
          }),
        );
        router.refresh();
      } else {
        toast(t("error_generic"));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <ArrowLeftRight className="size-4" />
        {t("handover_button")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) {
            setOpen(next);
            if (!next) setToId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("handover_title", { name: fromName })}</DialogTitle>
            <DialogDescription>
              {t("handover_hint", {
                name: fromName,
                engagements: counts.engagements,
                clients: counts.clients,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor="handover-to"
              className="text-sm font-medium text-foreground"
            >
              {t("handover_to_label")}
            </label>
            <select
              id="handover-to"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t("handover_to_placeholder")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {/* Said out loud because it is the surprising half: finished work
                keeps its original name. Rewriting who completed something would
                be a lie about the past. */}
            <p className="pt-1 text-xs text-muted-foreground">
              {t("handover_scope_note")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="button" disabled={pending || !toId} onClick={submit}>
              {t("handover_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
