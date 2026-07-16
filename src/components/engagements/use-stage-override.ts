"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { setEngagementStageAction } from "@/app/actions/stage";
import { stageLabelKey, type EngagementStage } from "@/lib/engagements/stage";

// The manual stage override, shared by the two surfaces that offer it: the
// header stepper's current node and the "..." row menu in the engagement tables.
// Kept in one hook so both report success and failure identically.
//
// The action can legitimately fail (migration 0690 not applied in this
// environment, or an RLS/DB error), and a silent no-op on a control the
// accountant just clicked is the worst outcome — they'd believe the stage moved.
// So a failure toasts, and the stage stays visibly where it was.
export function useStageOverride(engagementId: string): {
  setStage: (stage: EngagementStage) => void;
  pending: boolean;
} {
  const t = useTranslations("Stage");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setStage = (stage: EngagementStage) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("engagement_id", engagementId);
      fd.set("stage", stage);
      const res = await setEngagementStageAction(fd);
      if (res?.ok) {
        toast(t("changed_toast", { stage: t(stageLabelKey(stage)) }));
        // The action revalidates the server cache; refresh so the stepper and
        // every chip for this engagement redraw without a manual reload.
        router.refresh();
      } else {
        toast.error(t("set_error"));
      }
    });
  };

  return { setStage, pending };
}
