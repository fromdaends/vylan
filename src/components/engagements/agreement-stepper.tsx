import { Fragment } from "react";
import { useTranslations } from "next-intl";

import {
  AGREEMENT_STATUSES,
  agreementLabelKey,
  type AgreementStatus,
} from "@/lib/engagements/agreement";
import { cn } from "@/lib/cn";

// Where the AGREEMENT is, in the stepper the founder liked.
//
// Founder: "the old engagement statuses still exist on the full engagement
// view. I wanted them to only exist for document collection. Keep the same ui
// just rename it to match engagements."
//
// So: StageStepper's shape — dots, hairlines between them, the current one
// named and coloured — carrying the six agreement states instead of the six
// workflow stages.
//
// ── WHY THIS IS A SEPARATE COMPONENT, STATED OUT LOUD ──────────────────────
//
// CLAUDE.md's cohesion rule allows two surfaces to stay separate only when they
// genuinely differ in BEHAVIOUR, and these do, in the way that matters most:
//
//   StageStepper is an OVERRIDE CONTROL. Its current node is a dropdown; you
//   pick a stage and it writes one.
//   This is READ-ONLY, and must be. An agreement status is DERIVED from facts
//   that already exist — was it sent, has the client done anything, is it
//   complete. There is nothing to write. A dropdown here would be exactly the
//   dead control this codebase keeps deleting: it would offer to set "Accepted"
//   on an engagement no client has accepted.
//
// They still share what they can — the rail's markup and spacing are copied
// deliberately so the two read as one object. ⚠️ IF A THIRD STEPPER APPEARS,
// extract the rail (the dots + hairlines + current label) into a primitive and
// let both pass their own steps. Two is the point at which copying is still
// cheaper than the abstraction; three is not.

/**
 * The rail, in order. `cancelled` is deliberately NOT a step: it is an
 * off-ramp that can happen from anywhere, so putting it at the end would draw
 * every live engagement as one node away from being cancelled. When the
 * agreement IS cancelled the rail is replaced by a single chip below.
 */
const RAIL: AgreementStatus[] = AGREEMENT_STATUSES.filter(
  (s): s is AgreementStatus => s !== "cancelled",
);

// Three colours across the rail, matching AgreementChip's own reasoning: a
// distinct hue per state is what made the old column six washes saying nothing.
const DOT: Record<AgreementStatus, string> = {
  draft: "bg-muted-foreground/60",
  cancelled: "bg-muted-foreground/60",
  sent: "bg-accent",
  accepted: "bg-accent",
  active: "bg-accent",
  complete: "bg-success",
};
const TEXT: Record<AgreementStatus, string> = {
  draft: "text-muted-foreground",
  cancelled: "text-muted-foreground",
  sent: "text-accent",
  accepted: "text-accent",
  active: "text-accent",
  complete: "text-success",
};

export function AgreementStepper({ status }: { status: AgreementStatus }) {
  const t = useTranslations("Engagements");
  const label = t(agreementLabelKey(status));

  // Cancelled never reached the end of the rail, so drawing it there would be a
  // lie about how far it got. One muted chip, no rail.
  if (status === "cancelled") {
    return (
      <span className="flex items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", DOT.cancelled)} />
        <span className={cn("text-sm font-medium", TEXT.cancelled)}>
          {label}
        </span>
      </span>
    );
  }

  const currentIdx = RAIL.indexOf(status);

  return (
    <div
      role="group"
      aria-label={t("agreement_stepper_label")}
      className="flex min-w-0 items-center"
    >
      {RAIL.map((s, i) => {
        const done = currentIdx >= 0 && i < currentIdx;
        const isCurrent = s === status;
        return (
          <Fragment key={s}>
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
              <span
                aria-current="step"
                className="-my-1 flex shrink-0 items-center gap-1.5 px-1.5 py-1"
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", DOT[s])}
                  aria-hidden
                />
                <span
                  className={cn(
                    "whitespace-nowrap text-sm font-medium",
                    TEXT[s],
                  )}
                >
                  {t(agreementLabelKey(s))}
                </span>
              </span>
            ) : (
              <span
                title={t(agreementLabelKey(s))}
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  done ? DOT[s] : "bg-border",
                )}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
