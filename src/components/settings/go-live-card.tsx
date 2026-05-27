"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import {
  convertToLiveAction,
  type ConvertToLiveState,
} from "@/app/actions/firm-mode";

// Owner-only card surfaced at the top of /settings while the firm is
// in demo mode. One click flips the firm to live and resumes
// reminders on every engagement (seeded demos included — by going
// live the operator is telling us "treat this firm like real work").
// Server-side revalidatePath("/", "layout") refreshes the demo
// banner / block modals out of the in-app tree; we also nudge the
// router to refresh just so the on-page success copy lands quickly.
export function GoLiveCard() {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [state, action, pending] = useActionState<ConvertToLiveState, FormData>(
    async (prev, fd) => {
      const r = await convertToLiveAction(prev, fd);
      if (r?.ok) router.refresh();
      return r;
    },
    null,
  );

  if (state?.ok) {
    return (
      <section className="rounded-xl border border-success/40 bg-success/[0.06] p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-success/15 text-success shrink-0">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-success">
              {t("go_live_success_title")}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("go_live_success_body", {
                count: state.unpausedCount ?? 0,
              })}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-accent/40 bg-accent/[0.06] p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-accent/15 text-accent shrink-0">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t("go_live_title")}</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("go_live_body")}
            </p>
          </div>
          {state && !state.ok && (
            <p className="text-xs text-destructive">
              {state.error === "owner_only"
                ? t("go_live_owner_only")
                : state.error === "already_live"
                  ? t("go_live_already_live")
                  : t("go_live_failed")}
            </p>
          )}
          <form action={action}>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("go_live_pending") : t("go_live_cta")}
              {!pending && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
