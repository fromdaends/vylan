"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ArrowLeftRight } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { reassignEngagementAction } from "@/app/actions/engagements";
import { HANDOFF_NOTE_MAX } from "@/lib/engagements/handoff-note";

// Compact per-row "reassign this engagement" control for the teammate profile's
// work list — hand a colleague's engagement to someone else without leaving the
// page.
//
// This used to move the work SILENTLY: no note, on the grounds that the full
// reassign-with-note flow lived on the engagement page. That was the wrong way
// round. This control sits on a list of one person's work, which is exactly
// where you reassign during an offboarding or a holiday — the moment a note
// matters MOST — and the person receiving three engagements got three
// notifications with no word about any of them. The note is offered here too
// now, and it stays OPTIONAL: skip it and this behaves as it always did.
//
// Same dialog and the same copy keys as EngagementAssignee, deliberately: the
// two controls differ in SIZE, not in what reassigning means.
export function EngagementReassignMenu({
  engagementId,
  members,
}: {
  engagementId: string;
  // Reassignment targets — active teammates other than the current owner.
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("Team");
  const tEng = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The member picked in the dropdown, awaiting confirm + an optional note.
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [note, setNote] = useState("");

  if (members.length === 0) return null;

  function confirm() {
    if (!target) return;
    const noteToSend = note.trim();
    const memberId = target.id;
    setTarget(null);
    setNote("");
    startTransition(async () => {
      const res = await reassignEngagementAction(
        engagementId,
        memberId,
        noteToSend || undefined,
      );
      if (res.ok) router.refresh();
    });
  }

  function dismiss() {
    setTarget(null);
    setNote("");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            aria-label={t("profile_reassign")}
            title={t("profile_reassign")}
            className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          >
            <ArrowLeftRight className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{t("profile_reassign_to")}</DropdownMenuLabel>
          {members.map((m) => (
            <DropdownMenuItem
              key={m.id}
              // Defer opening the dialog past the dropdown's own close, or Radix
              // drops the focus handoff and the textarea never gets focus. Same
              // guard EngagementAssignee and team-manager already use.
              onSelect={() => setTimeout(() => setTarget(m), 0)}
              className="gap-2"
            >
              <AvatarInitials name={m.name} size={20} />
              <span className="flex-1 truncate">{m.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tEng("assign_dialog_title", { name: target?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{tEng("assign_dialog_hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor="quick-handoff-note"
              className="text-sm font-medium text-foreground"
            >
              {tEng("assign_note_label")}
            </label>
            <Textarea
              id="quick-handoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={HANDOFF_NOTE_MAX}
              rows={3}
              placeholder={tEng("assign_note_placeholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={dismiss}>
              {tc("cancel")}
            </Button>
            <Button type="button" onClick={confirm}>
              {tEng("assign_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
