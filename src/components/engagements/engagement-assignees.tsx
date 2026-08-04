"use client";

// The faces on a job, and the "+" that adds another.
//
// Founder, twice: "Theres no way still to add an assignee." Canopy's engagement
// card leads with a row of round faces and a + at the end; Vylan printed one
// name.
//
// ── FLAT, NO ROLE GROUPING, ON THE FOUNDER'S RULING ────────────────────────
//
// Canopy's picker groups people under Roles (Bookkeeper Team / Lawyer / Tax
// Prep) above a longer user list. We deliberately do NOT: the founder said
// "teams is something im building later down the line. so forget the team shit
// dont worry about it." One flat, searchable list of the firm's people. When
// teams arrive they become a GROUPING over this same list rather than a second
// picker beside it.
//
// ── THE PRIMARY WEARS A RING ───────────────────────────────────────────────
//
// engagements.assigned_user_id survives as the owner and six things read it, so
// the UI has to admit it exists — otherwise removing "just one of the faces"
// silently changes who the worklist says is accountable. First face, subtle
// ring, tooltip naming them. Not a badge: the founder's standing preference is
// that a control which is not always needed is not always shown.

import { useState } from "react";
import { Plus, Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";

export type AssigneePerson = { id: string; name: string };

export function EngagementAssignees({
  assigneeIds,
  primaryId,
  members,
  canEdit,
  onToggle,
}: {
  /** Everyone on the job, primary first (resolveAssignees order). */
  assigneeIds: string[];
  primaryId: string | null;
  members: AssigneePerson[];
  canEdit: boolean;
  /** `on` is the state being moved TO. The page owns the write. */
  onToggle: (userId: string, on: boolean) => void;
}) {
  const t = useTranslations("Engagements");
  const [open, setOpen] = useState(false);

  const byId = new Map(members.map((m) => [m.id, m]));
  const people = assigneeIds
    .map((id) => byId.get(id))
    .filter((p): p is AssigneePerson => Boolean(p));

  return (
    <div className="flex items-center gap-2">
      {people.length > 0 ? (
        <div className="flex items-center -space-x-1.5">
          {people.map((p) => (
            <span
              key={p.id}
              title={
                p.id === primaryId ? t("assignee_primary", { name: p.name }) : p.name
              }
              className={cn(
                "rounded-full ring-2 ring-card",
                // The owner, marked without a second control saying so.
                p.id === primaryId && "ring-accent",
              )}
            >
              <AvatarInitials name={p.name} size={32} />
            </span>
          ))}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{t("unassigned")}</span>
      )}

      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            aria-label={t("assignee_add")}
            title={t("assignee_add")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1">
            <div
              role="group"
              aria-label={t("assignee_add")}
              className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
            >
              {members.map((m) => {
                const on = assigneeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => onToggle(m.id, !on)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        on
                          ? "border-foreground bg-foreground text-background"
                          : "border-border",
                      )}
                    >
                      {on && <Check className="size-3" aria-hidden />}
                    </span>
                    <AvatarInitials name={m.name} size={20} />
                    <span className="truncate">{m.name}</span>
                  </button>
                );
              })}
              {members.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t("assignee_nobody")}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
