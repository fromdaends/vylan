"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  ENGAGEMENT_STAGES,
  STAGE_BG_CLASS,
  STAGE_TEXT_CLASS,
  stageLabelKey,
  type EngagementStage,
} from "@/lib/engagements/stage";
import { useStageOverride } from "./use-stage-override";

// The engagement header's stage stepper: a thin connected line of nodes showing
// only the stages this engagement actually has (applicableStages already hid the
// skipped ones server-side). No card, no box — it sits directly on the page,
// matching the "mesh, don't box" language.
//
// Reading it: past stages are quiet filled dots in their own hue, the current
// stage is a filled dot at full strength with its label spelled out, and future
// stages are hollow and dimmed. Only the current stage carries a visible label —
// that's the one fact you actually need at a glance; the rest are available on
// hover, where a past node also gives the date it was entered.
//
// The current node is the manual override control (click it to pick another
// stage). Past/future nodes are not clickable: jumping the workflow by clicking
// a dot you were only trying to read would be a nasty surprise, so the override
// lives on the node you're already looking at.
export function StageStepper({
  engagementId,
  stages,
  current,
  enteredAt,
  locale,
}: {
  engagementId: string;
  // The applicable stages in canonical order (from applicableStages()).
  stages: EngagementStage[];
  current: EngagementStage;
  // stage -> ISO timestamp it was entered, from stage_history. Sparse: an
  // engagement backfilled by migration 0690 only knows its current stage, and a
  // stage can be reached without a recorded entry.
  enteredAt: Partial<Record<EngagementStage, string>>;
  locale: AppLocale;
}) {
  const t = useTranslations("Stage");
  const { setStage, pending } = useStageOverride(engagementId);

  const currentIdx = stages.indexOf(current);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="group"
        aria-label={t("stepper_label")}
        className="flex min-w-0 items-center"
      >
        {stages.map((stage, i) => {
          // A stage the stepper doesn't know the position of (current isn't in
          // the list — shouldn't happen, applicableStages always includes it)
          // degrades to "future", which is the least misleading guess.
          const done = currentIdx >= 0 && i < currentIdx;
          const isCurrent = stage === current;
          const entered = enteredAt[stage];
          const label = t(stageLabelKey(stage));

          return (
            <Fragment key={stage}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-6 shrink-0 sm:w-8",
                    done || isCurrent ? "bg-border" : "bg-border/50",
                  )}
                />
              )}

              {isCurrent ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-current="step"
                      aria-label={`${t("current")}: ${label}. ${t("change")}`}
                      disabled={pending}
                      className={cn(
                        "group -my-1 flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full ring-4 ring-transparent transition-[box-shadow] group-hover:ring-current/10",
                          STAGE_BG_CLASS[stage],
                          STAGE_TEXT_CLASS[stage],
                        )}
                      />
                      <span
                        className={cn(
                          "whitespace-nowrap text-sm font-medium",
                          STAGE_TEXT_CLASS[stage],
                        )}
                      >
                        {label}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {/* Every stage is offered, not just the applicable ones:
                        this is an override. If the accountant wants to park an
                        engagement somewhere its contents don't justify, that's
                        the point of a manual control — and the next automatic
                        event will re-resolve it from reality anyway. */}
                    {ENGAGEMENT_STAGES.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onSelect={() => {
                          if (s !== current) setStage(s);
                        }}
                        className="gap-2"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            STAGE_BG_CLASS[s],
                          )}
                        />
                        <span className="flex-1">{t(stageLabelKey(s))}</span>
                        {s === current && (
                          <Check className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      role="img"
                      aria-label={
                        entered
                          ? `${label} — ${t("entered", {
                              date: formatDate(entered, locale, "medium"),
                            })}`
                          : label
                      }
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full transition-opacity",
                          done
                            ? cn(STAGE_BG_CLASS[stage], "opacity-50")
                            : "border border-border bg-transparent",
                        )}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    <span className="font-medium">{label}</span>
                    {/* The date a PAST stage was entered — the whole point of
                        keeping stage_history. Future stages have none, and say
                        only what they are. */}
                    {entered && done && (
                      <span className="block text-background/70">
                        {t("entered", {
                          date: formatDate(entered, locale, "medium"),
                        })}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
            </Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
