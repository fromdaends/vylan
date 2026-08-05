"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, Milestone, UserRound, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  bulkAssignEngagementsAction,
  bulkUpdateEngagementsAction,
} from "@/app/actions/engagements";
import { BULK_ASSIGN_MAX } from "@/lib/engagements/bulk-assign";
import {
  ENGAGEMENT_STAGES,
  STAGE_BG_CLASS,
  stageLabelKey,
} from "@/lib/engagements/stage";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";

// The bar that appears once you tick rows. Karbon's shape, and the one thing
// they have on assignment that Vylan didn't: filter a work list, tick the rows,
// move them all at once. Before this the only bulk path was "Hand over
// EVERYTHING" on a teammate's profile — all-or-nothing and owner-only, so
// moving eight of somebody's twelve files meant eight separate actions.
//
// It floats over the list rather than pushing it down, so ticking a row never
// reflows the thing you are ticking. Only mounted when something is selected —
// no permanently-parked toolbar over an untouched list, which is the founder's
// standing objection to controls that sit there doing nothing.
export function BulkAssignBar({
  selectedIds,
  members,
  onDone,
  onClear,
}: {
  selectedIds: string[];
  members: { id: string; name: string }[];
  // Fired after a successful move so the list can drop its selection and
  // refresh. The server already revalidated; this is the client catching up.
  onDone: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("Engagements");
  const tStage = useTranslations("Stage");
  const [pending, start] = useTransition();
  const count = selectedIds.length;
  if (count === 0) return null;

  const run = (assigneeId: string | null, label: string) => {
    if (pending) return;
    start(async () => {
      const res = await bulkAssignEngagementsAction(selectedIds, assigneeId);
      if (res.ok) {
        toast.success(
          assigneeId === null
            ? t("bulk_moved", { count: res.moved ?? 0 })
            : `${t("assigned_toast", { name: label })} · ${t("bulk_moved", { count: res.moved ?? 0 })}`,
        );
        onDone();
      } else if (res.error === "too_many") {
        toast.error(t("bulk_too_many", { max: BULK_ASSIGN_MAX }));
      } else {
        toast.error(t("bulk_failed"));
      }
    });
  };

  // EXPANDED BEYOND REASSIGNING (founder: "expand upon it so its not just
  // reassigning"). Stage and archive are the two other things the engagements
  // list already does one row at a time, so they are the two that can go in
  // bulk without inventing a writer nobody has exercised.
  //
  // Renders through the SHARED BulkActionBar now, the same one tasks and
  // clients use — so "Assign to" is one control in this product, not three
  // that resemble each other.
  const runUpdate = (
    patch: { stage?: string; archive?: boolean },
    label: string,
  ) => {
    if (pending) return;
    start(async () => {
      const res = await bulkUpdateEngagementsAction({
        engagementIds: selectedIds,
        ...patch,
      });
      if (res.ok) {
        toast.success(
          res.failed
            ? t("bulk_partial", { done: res.done ?? 0, total: count })
            : `${label} · ${t("bulk_moved", { count: res.done ?? 0 })}`,
        );
        onDone();
      } else if (res.error === "too_many") {
        toast.error(t("bulk_too_many", { max: BULK_ASSIGN_MAX }));
      } else {
        toast.error(t("bulk_failed"));
      }
    });
  };

  return (
    <BulkActionBar
      count={count}
      busy={pending}
      onClear={onClear}
      actions={[
        {
          key: "assign",
          label: t("bulk_assign_to"),
          icon: UserRound,
          submenu: [
            ...members.map((m) => ({
              key: m.id,
              label: m.name,
              onSelect: () => run(m.id, m.name),
            })),
            // Unassigning in bulk is a real need, not an edge case: it is how
            // you clear a leaver's plate before deciding where each file goes.
            {
              key: "__nobody",
              label: t("assign_nobody"),
              onSelect: () => run(null, ""),
            },
          ],
        },
        {
          key: "stage",
          label: tStage("change"),
          icon: Milestone,
          submenu: ENGAGEMENT_STAGES.map((st) => ({
            key: st,
            label: tStage(stageLabelKey(st)),
            dotClass: STAGE_BG_CLASS[st],
            onSelect: () => runUpdate({ stage: st }, tStage(stageLabelKey(st))),
          })),
        },
      ]}
      moreActions={[
        {
          key: "archive",
          label: t("menu_archive"),
          icon: Archive,
          variant: "destructive" as const,
          onSelect: () => runUpdate({ archive: true }, t("menu_archive")),
        },
      ]}
    />
  );
}
