"use client";

// The workflow's "waiting for your tap" — the approval the confirm gates were
// designed around and the surface the coherence audit found missing (every
// built-in flow gates in_review, so without this card every flag-on
// engagement parked there forever).
//
// Kept deliberately small and self-contained: one line saying what is waiting
// and one button. It renders only when a gate is actually pending — the
// server page asks getPendingWorkflowGate and mounts nothing otherwise, so
// engagements without workflows (or firms without the switch) never see it.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveWorkflowGateAction } from "@/app/actions/stage";
import { stageLabelKey, type EngagementStage } from "@/lib/engagements/stage";

export function WorkflowGateCard({
  engagementId,
  from,
  to,
}: {
  engagementId: string;
  from: EngagementStage;
  to: EngagementStage;
}) {
  const t = useTranslations("Stage");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function approve() {
    const fd = new FormData();
    fd.set("engagement_id", engagementId);
    fd.set("stage", from);
    startTransition(async () => {
      const res = await approveWorkflowGateAction(fd);
      if (res?.ok) {
        toast.success(t("gate_approved_toast"));
        router.refresh();
      } else {
        toast.error(t("gate_error_toast"));
      }
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-subtle px-4 py-3">
      <Zap className="size-4 shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{t("gate_waiting")}</span>{" "}
        <span className="text-muted-foreground">
          {t("gate_move", {
            from: t(stageLabelKey(from)),
            to: t(stageLabelKey(to)),
          })}
        </span>
      </p>
      <Button size="sm" disabled={pending} onClick={approve}>
        {t("gate_approve")}
        <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
