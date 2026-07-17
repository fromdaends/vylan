"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AlertTriangle, Check, ChevronDown, UserRound } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

// "Assigned to / Assigné à" control on the engagement detail. Shows who's
// accountable (avatar + name) and lets any firm member reassign to any ACTIVE
// member. Reassigning opens a small confirm dialog with an optional HANDOFF NOTE
// ("vehicle log still missing…") — the note reaches the new assignee in their
// "assigned to you" notification. Accountability only — visibility stays
// firm-wide.
export function EngagementAssignee({
  engagementId,
  assigneeId,
  assigneeName,
  assigneeDeactivated,
  members,
}: {
  engagementId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeDeactivated: boolean;
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("Engagements");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic label so the new assignee shows immediately on confirm.
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const displayName = optimisticName ?? assigneeName;
  // The member picked in the dropdown, awaiting confirm + an optional note.
  const [target, setTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [note, setNote] = useState("");

  function pick(memberId: string, memberName: string) {
    if (memberId === assigneeId) return;
    setNote("");
    setTarget({ id: memberId, name: memberName });
  }

  function confirmAssign() {
    if (!target) return;
    const memberName = target.name;
    const memberId = target.id;
    const noteToSend = note.trim();
    setOptimisticName(memberName);
    setTarget(null);
    startTransition(async () => {
      const res = await reassignEngagementAction(
        engagementId,
        memberId,
        noteToSend || undefined,
      );
      if (res.ok) {
        router.refresh();
      } else {
        setOptimisticName(null); // revert on failure
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t("assigned_to")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 py-1 pl-1 pr-2.5 text-sm transition-colors hover:bg-card disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {displayName ? (
                <>
                  <AvatarInitials name={displayName} size={20} />
                  <span className="font-medium text-foreground">
                    {displayName}
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-3" />
                  </span>
                  <span className="italic text-muted-foreground">
                    {t("unassigned")}
                  </span>
                </>
              )}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => pick(m.id, m.name)}
                className="gap-2"
              >
                <AvatarInitials name={m.name} size={20} />
                <span className="flex-1 truncate">{m.name}</span>
                {m.id === assigneeId && (
                  <Check className="size-3.5 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {assigneeDeactivated && !optimisticName && (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
          <AlertTriangle className="size-3" />
          {t("assignee_deactivated")}
        </div>
      )}

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("assign_dialog_title", { name: target?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("assign_dialog_hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor="handoff-note"
              className="text-sm font-medium text-foreground"
            >
              {t("assign_note_label")}
            </label>
            <Textarea
              id="handoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={HANDOFF_NOTE_MAX}
              rows={3}
              placeholder={t("assign_note_placeholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
            >
              {tc("cancel")}
            </Button>
            <Button type="button" onClick={confirmAssign}>
              {t("assign_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
