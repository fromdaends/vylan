"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  UserRound,
  UserRoundCheck,
} from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { reassignEngagementAction } from "@/app/actions/engagements";
import { toastAssigned } from "./assigned-toast";

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
  viewerId,
  handoff,
}: {
  engagementId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeDeactivated: boolean;
  members: { id: string; name: string }[];
  // The signed-in user, so "Take it" can appear. Karbon has the same one-click
  // self-assign ("Assign to Me", plus typing "me" in their picker) and it is
  // the single most-used assignment there is: picking your own name out of a
  // list to claim work you are already looking at is a silly amount of aim.
  viewerId: string;
  // The note left by whoever last handed this over. Rendered right under the
  // assignee because that is the only place it is ever looked for — until now
  // it lived only in the activity feed and the notification, so once the
  // notification was read the instructions were effectively lost.
  handoff?: { note: string; from: string | null; at: string } | null;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic label so the new assignee shows immediately on confirm.
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const displayName = optimisticName ?? assigneeName;

  // Assign on click. No dialog: see assigned-toast.tsx for why the
  // confirmation moved into the toast and became optional.
  function pick(memberId: string, memberName: string) {
    if (memberId === assigneeId || pending) return;
    setOptimisticName(memberName);
    startTransition(async () => {
      const res = await reassignEngagementAction(engagementId, memberId);
      if (res.ok) {
        router.refresh();
        toastAssigned({
          engagementId,
          message: t("assigned_toast", { name: memberName }),
          addNoteLabel: t("assign_add_note"),
          placeholder: t("assign_note_placeholder"),
          saveLabel: t("assign_note_send"),
          savedLabel: t("assign_note_saved"),
        });
      } else {
        setOptimisticName(null); // revert
      }
    });
  }

  // Taking work yourself offers no note, for the same reason unassigning does
  // not: a handoff note is instructions FOR the person receiving the work, and
  // here that is you. Being offered a note to write yourself would be absurd.
  function takeIt() {
    if (!viewerId || viewerId === assigneeId) return;
    const me = members.find((m) => m.id === viewerId);
    if (!me) return;
    setOptimisticName(me.name);
    startTransition(async () => {
      const res = await reassignEngagementAction(engagementId, viewerId);
      if (res.ok) router.refresh();
      else setOptimisticName(null);
    });
  }

  // Clearing the assignee offers no note: a handoff note is addressed to the
  // person taking the work over, and there isn't one.
  function unassign() {
    if (assigneeId === null) return;
    setOptimisticName(null);
    startTransition(async () => {
      const res = await reassignEngagementAction(engagementId, null);
      if (res.ok) router.refresh();
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
            {viewerId !== assigneeId &&
              members.some((m) => m.id === viewerId) && (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      takeIt();
                    }}
                    className="gap-2"
                  >
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserRoundCheck className="size-3" />
                    </span>
                    <span className="flex-1 truncate font-medium">
                      {t("assign_to_me")}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
            {members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                // preventDefault keeps the menu from closing as the dialog
                // opens — otherwise the menu's and dialog's overlays fight over
                // <body> pointer-events and can leave the WHOLE page unclickable
                // (Radix dropdown→dialog handoff). Same guard team-manager uses.
                onSelect={(e) => {
                  e.preventDefault();
                  pick(m.id, m.name);
                }}
                className="gap-2"
              >
                <AvatarInitials name={m.name} size={20} />
                <span className="flex-1 truncate">{m.name}</span>
                {m.id === assigneeId && (
                  <Check className="size-3.5 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            {assigneeId !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    unassign();
                  }}
                  className="gap-2"
                >
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="size-3" />
                  </span>
                  <span className="flex-1 truncate">{t("unassign")}</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Hidden while an optimistic reassignment is in flight: the note belongs
          to the PREVIOUS handoff, and showing it next to a new assignee's name
          reads as instructions for them. It returns on refresh if still current. */}
      {handoff && !optimisticName && (
        <div className="w-fit max-w-prose rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5">
          <p className="text-xs leading-relaxed text-foreground">
            {handoff.note}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {handoff.from
              ? t("handoff_from", { name: handoff.from, date: handoff.at })
              : t("handoff_at", { date: handoff.at })}
          </p>
        </div>
      )}

      {assigneeDeactivated && !optimisticName && (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
          <AlertTriangle className="size-3" />
          {t("assignee_deactivated")}
        </div>
      )}

    </div>
  );
}
