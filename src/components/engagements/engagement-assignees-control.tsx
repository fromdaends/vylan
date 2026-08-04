"use client";

// The client half of the faces-and-plus control.
//
// ⚠️ THIS WRAPPER EXISTS FOR A SPECIFIC REASON, not as ceremony: the engagement
// page is a Server Component, and handing a function prop across that boundary
// is a 500 that neither tsc nor `next build` catches (it has bitten this repo
// twice — see the RSC client-boundary note). So the page passes plain data, and
// the write handler is created HERE, on the client side of the line.
//
// Optimistic with rollback, the same contract the detail panel's reassign uses:
// a toggle the server refuses must not keep showing on the card.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import {
  EngagementAssignees,
  type AssigneePerson,
} from "@/components/engagements/engagement-assignees";
import {
  addEngagementAssigneeAction,
  removeEngagementAssigneeAction,
} from "@/app/actions/engagement-assignees";

export function EngagementAssigneesControl({
  engagementId,
  assigneeIds,
  primaryId,
  members,
  canEdit,
}: {
  engagementId: string;
  assigneeIds: string[];
  primaryId: string | null;
  members: AssigneePerson[];
  canEdit: boolean;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  // null = "no local opinion, render what the server gave us". Seeded lazily
  // rather than mirrored from props in an effect, which would render one frame
  // of the previous engagement's list.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const shown = optimistic ?? assigneeIds;

  const onToggle = (userId: string, on: boolean) => {
    const before = shown;
    const next = on
      ? [...shown, userId]
      : shown.filter((id) => id !== userId);
    setOptimistic(next);

    startTransition(async () => {
      const res = on
        ? await addEngagementAssigneeAction({ engagementId, userId })
        : await removeEngagementAssigneeAction({ engagementId, userId });
      if (res.ok) {
        // Let the server's own answer take over again — it also knows whether
        // the PRIMARY moved, which this component deliberately does not model.
        setOptimistic(null);
        router.refresh();
        return;
      }
      setOptimistic(before);
      toast.error(
        res.needsMigration ? t("assignee_needs_migration") : t("assignee_failed"),
      );
    });
  };

  return (
    <EngagementAssignees
      assigneeIds={shown}
      primaryId={primaryId}
      members={members}
      canEdit={canEdit}
      onToggle={onToggle}
    />
  );
}
